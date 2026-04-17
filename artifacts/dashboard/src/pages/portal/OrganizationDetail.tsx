import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Mail, Trash2, UserMinus, Copy } from "lucide-react";

interface Member {
  userId: number;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

interface OrgDetail {
  organization: { id: number; name: string; slug: string; role: string; creditBalance: number; topupCreditBalance: number };
  members: Member[];
}

interface Invite {
  id: number;
  email: string;
  role: string;
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

const ROLES = ["admin", "developer", "viewer"];

export default function OrganizationDetail() {
  const { id } = useParams<{ id: string }>();
  const orgId = Number(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const isAr = i18n.language === "ar";
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("developer");
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["portal-org", orgId],
    queryFn: async () => {
      const res = await authFetch(`/portal/organizations/${orgId}`);
      if (!res.ok) throw new Error("Failed to load");
      return (await res.json()) as OrgDetail;
    },
  });

  const isOwnerOrAdmin = data?.organization.role === "owner" || data?.organization.role === "admin";

  const { data: invitesData } = useQuery({
    queryKey: ["portal-org-invites", orgId],
    queryFn: async () => {
      const res = await authFetch(`/portal/organizations/${orgId}/invites`);
      if (!res.ok) throw new Error("Failed to load");
      return (await res.json()) as { invites: Invite[] };
    },
    enabled: !!isOwnerOrAdmin,
  });

  const sendInvite = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/portal/organizations/${orgId}/invites`, {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-org-invites", orgId] });
      setInviting(false); setInviteEmail("");
      toast({ title: t("orgs.invite.sent") });
    },
    onError: (err: Error) => toast({ title: t("common.error"), description: err.message, variant: "destructive" }),
  });

  const revokeInvite = useMutation({
    mutationFn: async (inviteId: number) => {
      const res = await authFetch(`/portal/organizations/${orgId}/invites/${inviteId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-org-invites", orgId] }),
  });

  const removeMember = useMutation({
    mutationFn: async (userId: number) => {
      const res = await authFetch(`/portal/organizations/${orgId}/members/${userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-org", orgId] }),
    onError: (err: Error) => toast({ title: t("common.error"), description: err.message, variant: "destructive" }),
  });

  const changeRole = useMutation({
    mutationFn: async (params: { userId: number; role: string }) => {
      const res = await authFetch(`/portal/organizations/${orgId}/members/${params.userId}`, {
        method: "PATCH", body: JSON.stringify({ role: params.role }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-org", orgId] }),
    onError: (err: Error) => toast({ title: t("common.error"), description: err.message, variant: "destructive" }),
  });

  const rename = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/portal/organizations/${orgId}`, { method: "PATCH", body: JSON.stringify({ name: newName }) });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-org", orgId] });
      qc.invalidateQueries({ queryKey: ["portal-orgs"] });
      setRenaming(false);
    },
  });

  const deleteOrg = useMutation({
    mutationFn: async () => {
      const res = await authFetch(`/portal/organizations/${orgId}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-orgs"] });
      navigate("/portal/organizations");
    },
    onError: (err: Error) => toast({ title: t("common.error"), description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (!data) return <p className="text-sm text-destructive">{t("common.error")}</p>;

  const { organization, members } = data;
  const inviteUrlBase = window.location.origin + (import.meta.env.BASE_URL || "/");

  return (
    <div className={`space-y-6 ${isAr ? "text-right" : ""}`}>
      <Button variant="ghost" onClick={() => navigate("/portal/organizations")} className="gap-2">
        <ArrowLeft className={`h-4 w-4 ${isAr ? "rotate-180" : ""}`} /> {t("common.back")}
      </Button>

      <div>
        <h1 className="text-2xl font-bold">{organization.name}</h1>
        <p className="text-sm text-muted-foreground">{organization.slug} · <Badge variant="outline">{t(`orgs.role.${organization.role}`)}</Badge></p>
      </div>

      <Card>
        <CardHeader>
          <div className={`flex items-center justify-between ${isAr ? "flex-row-reverse" : ""}`}>
            <CardTitle>{t("orgs.members")}</CardTitle>
            {isOwnerOrAdmin && (
              <Button size="sm" onClick={() => setInviting(true)} className="gap-2">
                <Mail className="h-4 w-4" /> {t("orgs.invite.button")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.userId} className={`border rounded-lg p-3 flex items-center justify-between gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                <div className={isAr ? "text-right" : ""}>
                  <p className="font-medium text-sm">{m.name || m.email}</p>
                  <p className="text-xs text-muted-foreground">{m.email}</p>
                </div>
                <div className={`flex items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
                  {isOwnerOrAdmin && m.role !== "owner" ? (
                    <Select value={m.role} onValueChange={(v) => changeRole.mutate({ userId: m.userId, role: v })}>
                      <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => <SelectItem key={r} value={r}>{t(`orgs.role.${r}`)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline">{t(`orgs.role.${m.role}`)}</Badge>
                  )}
                  {isOwnerOrAdmin && m.role !== "owner" && (
                    <Button variant="ghost" size="icon" onClick={() => { if (confirm(t("common.confirm"))) removeMember.mutate(m.userId); }}>
                      <UserMinus className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {isOwnerOrAdmin && (
        <Card>
          <CardHeader><CardTitle>{t("orgs.pendingInvites")}</CardTitle></CardHeader>
          <CardContent>
            {!invitesData?.invites.length ? (
              <p className="text-sm text-muted-foreground">{t("orgs.noPendingInvites")}</p>
            ) : (
              <div className="space-y-2">
                {invitesData.invites.map((inv) => {
                  const link = `${inviteUrlBase}portal/invite/${inv.token}`;
                  return (
                    <div key={inv.id} className={`border rounded-lg p-3 ${isAr ? "text-right" : ""}`}>
                      <div className={`flex items-center justify-between gap-3 ${isAr ? "flex-row-reverse" : ""}`}>
                        <div>
                          <p className="text-sm font-medium">{inv.email}</p>
                          <p className="text-xs text-muted-foreground">
                            {t(`orgs.role.${inv.role}`)} · {t("orgs.expires")} {new Date(inv.expiresAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className={`flex items-center gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
                          <Button variant="ghost" size="icon" onClick={() => { navigator.clipboard.writeText(link); toast({ title: t("common.copied") }); }}>
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => revokeInvite.mutate(inv.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                      <code className="block mt-2 text-xs text-muted-foreground break-all">{link}</code>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {organization.role === "owner" && (
        <Card>
          <CardHeader><CardTitle>{t("orgs.dangerZone")}</CardTitle></CardHeader>
          <CardContent className={`flex flex-wrap gap-2 ${isAr ? "flex-row-reverse" : ""}`}>
            <Button variant="outline" onClick={() => { setNewName(organization.name); setRenaming(true); }}>{t("orgs.rename")}</Button>
            <Button variant="destructive" onClick={() => { if (confirm(t("orgs.confirmDelete"))) deleteOrg.mutate(); }}>
              {t("orgs.delete")}
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("orgs.invite.button")}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>{t("common.email")}</Label>
              <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="teammate@example.com" />
            </div>
            <div>
              <Label>{t("orgs.role.label")}</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => <SelectItem key={r} value={r}>{t(`orgs.role.${r}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviting(false)}>{t("common.cancel")}</Button>
            <Button onClick={() => sendInvite.mutate()} disabled={!inviteEmail || sendInvite.isPending}>{t("orgs.invite.send")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("orgs.rename")}</DialogTitle></DialogHeader>
          <div className="grid gap-2">
            <Label>{t("orgs.name")}</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>{t("common.cancel")}</Button>
            <Button onClick={() => rename.mutate()} disabled={!newName.trim()}>{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
