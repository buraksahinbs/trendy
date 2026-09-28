import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="grid gap-6">
      <Card className="gap-5 shadow-lg shadow-black/[0.03]">
        <CardHeader className="text-center">
          <CardTitle className="text-xl tracking-tight">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
      <p className="text-muted-foreground text-center text-sm">{footer}</p>
    </div>
  );
}
