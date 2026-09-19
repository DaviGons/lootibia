"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { emailDoUsuario, normalizarUsuario, senhaFoiDefinida } from "@/lib/conta";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErro(null);

    // Mesma frase para nome inválido, nome inexistente e senha errada. Distinguir
    // os casos entregaria de graça a lista de quem tem conta aqui.
    const GENERICO = "Usuário ou senha inválidos.";
    const nome = normalizarUsuario(usuario);
    if (!nome) {
      setErro(GENERICO);
      setEnviando(false);
      return;
    }

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailDoUsuario(nome),
        password: senha,
      });
      if (error) throw error;

      // Quem entrou com o código de ativação ainda não tem senha própria. O
      // middleware barra de qualquer forma; mandar direto evita um salto a mais.
      router.push(
        senhaFoiDefinida(data.user?.user_metadata) ? "/hunts" : "/auth/definir-senha",
      );
    } catch {
      setErro(GENERICO);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Entrar</CardTitle>
          <CardDescription>
            Primeiro acesso? Use o código de ativação no lugar da senha.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={entrar}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="usuario">Usuário</Label>
                <Input
                  id="usuario"
                  name="username"
                  // `username` + `current-password` fazem o gerenciador de senhas
                  // do navegador reconhecer o formulário e oferecer o preenchimento.
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="seu usuário"
                  required
                  value={usuario}
                  onChange={(e) => setUsuario(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="senha">Senha ou código</Label>
                <Input
                  id="senha"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                />
              </div>
              {erro && (
                <p role="alert" className="text-sm text-destructive">
                  {erro}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={enviando}>
                {enviando ? "Entrando…" : "Entrar"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                As contas são criadas pelo administrador. Perdeu a senha? Peça um
                código novo.
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
