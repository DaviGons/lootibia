import Link from "next/link";
import { Marca } from "@/components/marca";
import { LoginForm } from "@/components/login-form";

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        {/* A marca leva de volta para o app: quem caiu aqui por engano tem saida. */}
        <Link href="/hunts" className="mb-8 flex justify-center text-foreground">
          <Marca altura={28} />
        </Link>
        <LoginForm />
      </div>
    </div>
  );
}
