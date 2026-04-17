import { useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { usePortalLogin } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Terminal, CheckCircle2, AlertCircle } from "lucide-react";
import i18n from "@/i18n";

export default function PortalLogin() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, isAuthenticated, user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();
  const portalLogin = usePortalLogin();
  const isAr = i18n.language === "ar";

  const verifiedStatus = searchParams.get("verified");
  const verifiedReason = searchParams.get("reason");

  const loginSchema = z.object({
    email: z.string().email(isAr ? "أدخل بريداً إلكترونياً صحيحاً" : "Please enter a valid email address"),
    password: z.string().min(1, isAr ? "كلمة المرور مطلوبة" : "Password is required"),
  });

  useEffect(() => {
    if (isAuthenticated && user?.role === "developer") {
      navigate("/portal", { replace: true });
    }
  }, [isAuthenticated, user, navigate]);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = (data: z.infer<typeof loginSchema>) => {
    portalLogin.mutate(
      { data },
      {
        onSuccess: (res) => {
          login(res.user);
        },
        onError: (error) => {
          toast({ title: t("auth.signInFailed"), description: error.message || t("auth.invalidCredentials"), variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/40 p-4" dir={isAr ? "rtl" : "ltr"}>
      <div className="mb-8 flex flex-col items-center">
        <div className="bg-primary/10 p-3 rounded-full mb-4">
          <Terminal className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">AI Gateway</h1>
        <p className="text-muted-foreground mt-2">{t("portal.title")}</p>
      </div>

      {verifiedStatus === "success" && (
        <div className="w-full max-w-md mb-4 flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">{isAr ? "تم التحقق من بريدك الإلكتروني!" : "Email verified!"}</p>
            <p className="text-xs opacity-80">{isAr ? "يمكنك الآن تسجيل الدخول." : "You can now sign in to your account."}</p>
          </div>
        </div>
      )}
      {verifiedStatus === "already" && (
        <div className="w-full max-w-md mb-4 flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-700 dark:text-blue-400">
          <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">{isAr ? "البريد الإلكتروني محقق مسبقاً" : "Email already verified"}</p>
            <p className="text-xs opacity-80">{isAr ? "حسابك نشط. سجّل الدخول للمتابعة." : "Your account is active. Sign in to continue."}</p>
          </div>
        </div>
      )}
      {verifiedStatus === "error" && (
        <div className="w-full max-w-md mb-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">
              {verifiedReason === "expired"
                ? (isAr ? "انتهت صلاحية رابط التفعيل" : "Verification link expired")
                : (isAr ? "رابط التفعيل غير صالح" : "Invalid verification link")}
            </p>
            <p className="text-xs opacity-80">{isAr ? "اطلب رابطاً جديداً من صفحة تسجيل الدخول." : "Request a new verification link from the sign-in page."}</p>
          </div>
        </div>
      )}

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t("auth.developerSignIn")}</CardTitle>
          <CardDescription>{t("auth.developerSignInDesc")}</CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <Label>{t("auth.email")}</Label>
                  <FormControl>
                    <Input placeholder="developer@example.com" type="email" {...field} data-testid="input-email" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem>
                  <Label>{t("auth.password")}</Label>
                  <FormControl>
                    <Input placeholder="••••••••" type="password" {...field} data-testid="input-password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button type="submit" className="w-full" disabled={portalLogin.isPending} data-testid="button-submit">
                {portalLogin.isPending ? (isAr ? "جارٍ الدخول..." : "Signing in...") : t("auth.signIn")}
              </Button>
              <div className="flex items-center justify-between w-full text-sm text-muted-foreground">
                <Link to="/forgot-password" className="text-primary hover:underline font-medium">
                  {t("auth.forgotPassword")}
                </Link>
                <span>
                  {t("auth.noAccount")}{" "}
                  <Link to="/signup" className="text-primary hover:underline font-medium">
                    {t("auth.signUp")}
                  </Link>
                </span>
              </div>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  );
}
