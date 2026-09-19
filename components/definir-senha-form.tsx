"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { MIN_SENHA, problemaDaSenha, usuarioDoEmail } from "@/lib/conta";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Troca o código de ativação por uma senha de verdade.
 *
 * Serve ao primeiro acesso (obrigatório, imposto pelo middleware) e à troca
 * voluntária depois. A única diferença é o texto.
 */
export function DefinirSenhaForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const [senha, setSenha] = useState("");
  const [repetida, setRepetida] = useState("");
  const [usuario, setUsuario] = useState<string | null>(null);
  const [jaTinhaSenha, setJaTinhaSenha] = useState<boolean | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        setUsuario(usuarioDoEmail(data.user?.email));
        setJaTinhaSenha(data.user?.user_metadata?.senha_definida === true);
      });
  }, []);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);

    const problema = problemaDaSenha(senha, usuario);
    if (problema) return setErro(problema);
    if (senha !== repetida) return setErro("As duas senhas não são iguais.");

    setEnviando(true);
    try {
      const supabase = createClient();
      // Uma chamada só: senha nova e flag juntas. Se fossem duas, uma falha no
      // meio deixaria a conta dizendo "senha definida" com o código ainda valendo.
      const { error } = await supabase.auth.updateUser({
        password: senha,
        data: { senha_definida: true },
      });
      if (error) throw error;

      // O middleware lê a flag das claims do JWT. Sem renovar, o token em mãos
      // ainda diz `senha_definida: false` e a próxima navegação volta para cá.
      await supabase.auth.refreshSession();

      router.push("/hunts");
      router.refresh();
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Não deu para salvar a senha.");
      setEnviando(false);
    }
  };

  const primeiroAcesso = jaTinhaSenha === false;

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">
            {primeiroAcesso ? "Escolha sua senha" : "Trocar a senha"}
          </CardTitle>
          <CardDescription>
            {primeiroAcesso
              ? "Você entrou com o código de ativação. Defina uma senha para continuar — o código deixa de valer."
              : `Pelo menos ${MIN_SENHA} caracteres.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={salvar}>
            <div className="flex flex-col gap-6">
              {/* Escondido, mas presente: sem ele o gerenciador de senhas não
                  sabe a qual conta associar a senha nova. */}
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={usuario ?? ""}
                readOnly
                hidden
              />
              <div className="grid gap-2">
                <Label htmlFor="senha">Nova senha</Label>
                <Input
                  id="senha"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={MIN_SENHA}
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="repetida">Repita a senha</Label>
                <Input
                  id="repetida"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={repetida}
                  onChange={(e) => setRepetida(e.target.value)}
                />
              </div>
              {erro && (
                <p role="alert" className="text-sm text-destructive">
                  {erro}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={enviando}>
                {enviando ? "Salvando…" : "Salvar senha"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
