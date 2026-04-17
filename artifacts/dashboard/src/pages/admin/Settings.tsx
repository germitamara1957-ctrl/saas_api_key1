import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save, Mail, CheckCircle2, Send, Globe } from "lucide-react";

interface SmtpSettings {
  smtp_host: string | null;
  smtp_port: string | null;
  smtp_user: string | null;
  smtp_pass: string | null;
  smtp_from: string | null;
  app_base_url: string | null;
}

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchSettings(): Promise<SmtpSettings> {
  const res = await fetch(`${API_BASE}/api/admin/settings`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load settings");
  return res.json() as Promise<SmtpSettings>;
}

async function saveSettings(data: Record<string, string>): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/settings`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
    throw new Error(err.error ?? "Failed to save settings");
  }
}

async function sendTestEmail(to: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/settings/test-email`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
    throw new Error(err.error ?? "Failed to send test email");
  }
}

export default function AdminSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState("");
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState<SmtpSettings>({
    smtp_host: "",
    smtp_port: "587",
    smtp_user: "",
    smtp_pass: "",
    smtp_from: "",
    app_base_url: "",
  });

  useEffect(() => {
    fetchSettings()
      .then((data) => {
        setForm({
          smtp_host: data.smtp_host ?? "",
          smtp_port: data.smtp_port ?? "587",
          smtp_user: data.smtp_user ?? "",
          smtp_pass: data.smtp_pass ?? "",
          smtp_from: data.smtp_from ?? "",
          app_base_url: data.app_base_url ?? "",
        });
      })
      .catch(() => {
        toast({ title: "Error", description: "Could not load settings", variant: "destructive" });
      })
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (key: keyof SmtpSettings) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      if (form.smtp_host) payload.smtp_host = form.smtp_host;
      if (form.smtp_port) payload.smtp_port = form.smtp_port;
      if (form.smtp_user) payload.smtp_user = form.smtp_user;
      if (form.smtp_pass && form.smtp_pass !== "••••••••") payload.smtp_pass = form.smtp_pass;
      if (form.smtp_from) payload.smtp_from = form.smtp_from;
      if (form.app_base_url) payload.app_base_url = form.app_base_url;

      await saveSettings(payload);
      setSaved(true);
      toast({ title: "Saved", description: "SMTP settings saved successfully." });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to save settings",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    if (!testEmailAddress) {
      toast({ title: "Enter email", description: "Please enter an email address to send the test to.", variant: "destructive" });
      return;
    }
    setTestingEmail(true);
    try {
      await sendTestEmail(testEmailAddress);
      toast({ title: "Test email sent", description: `Test email sent to ${testEmailAddress}` });
    } catch (err) {
      toast({
        title: "Failed to send",
        description: err instanceof Error ? err.message : "Could not send test email",
        variant: "destructive",
      });
    } finally {
      setTestingEmail(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Platform Settings</h1>
        <p className="text-muted-foreground mt-1">Configure email delivery and platform integrations.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            <CardTitle>Platform URL</CardTitle>
          </div>
          <CardDescription>
            Used in email links (verification, password reset). Leave blank to auto-detect from the incoming request domain.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="app_base_url">App Base URL <span className="text-muted-foreground font-normal text-xs">(optional override)</span></Label>
            <Input
              id="app_base_url"
              placeholder="Auto-detected from domain — leave blank"
              value={form.app_base_url ?? ""}
              onChange={handleChange("app_base_url")}
              type="url"
            />
            <p className="text-xs text-muted-foreground">
              Leave empty for automatic detection. Only set this if links in emails point to the wrong domain.
            </p>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : saved ? (
                <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {saved ? "Saved!" : "Save Settings"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            <CardTitle>SMTP Email Settings</CardTitle>
          </div>
          <CardDescription>
            Configure your email server to send verification emails, password resets, and low-credit alerts to developers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="smtp_host">SMTP Host</Label>
              <Input
                id="smtp_host"
                placeholder="smtp.gmail.com"
                value={form.smtp_host ?? ""}
                onChange={handleChange("smtp_host")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp_port">Port</Label>
              <Input
                id="smtp_port"
                placeholder="587"
                value={form.smtp_port ?? ""}
                onChange={handleChange("smtp_port")}
                type="number"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="smtp_user">Username / Email</Label>
            <Input
              id="smtp_user"
              placeholder="your@email.com"
              value={form.smtp_user ?? ""}
              onChange={handleChange("smtp_user")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="smtp_pass">Password / App Password</Label>
            <Input
              id="smtp_pass"
              type="password"
              placeholder="Enter password (leave blank to keep current)"
              value={form.smtp_pass ?? ""}
              onChange={handleChange("smtp_pass")}
            />
            <p className="text-xs text-muted-foreground">
              For Gmail, use an <strong>App Password</strong> (16-character code).{" "}
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:opacity-80"
              >
                Click here to generate one →
              </a>
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="smtp_from">From Address</Label>
            <Input
              id="smtp_from"
              placeholder="noreply@yourdomain.com"
              value={form.smtp_from ?? ""}
              onChange={handleChange("smtp_from")}
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : saved ? (
                <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {saved ? "Saved!" : "Save Settings"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
            <CardTitle>Test Email</CardTitle>
          </div>
          <CardDescription>
            Send a test email to verify your SMTP configuration is working correctly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input
              placeholder="recipient@example.com"
              value={testEmailAddress}
              onChange={(e) => setTestEmailAddress(e.target.value)}
              type="email"
              className="max-w-sm"
            />
            <Button variant="outline" onClick={handleTestEmail} disabled={testingEmail}>
              {testingEmail ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Send Test
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
