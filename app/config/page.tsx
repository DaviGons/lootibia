import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hasEnvVars } from "@/lib/utils";
import { usuarioDoEmail } from "@/lib/conta";
import { Marca } from "@/components/marca";
import { VinculoDiscord } from "@/app/hunts/formulario";
import { removerPersonagem } from "@/app/hunts/pastas";
import { CadastrarPersonagem, PrecoDoMundo } from "./formularios";

// Mesma razão da /hunts: ler `cookies()` fora de <Suspense> é erro de build
// com Cache Components (diretriz 32).

interface CharLigado {
  personagem: {
    id: number;
    nome: string;
    mundo: string | null;
    vocacao: string | null;
    nivel: number | null;
    visto_em: string | null;
  } | null;
}

export default function PaginaConfig() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-10 flex items-center justify-between gap-4">
        <Link href="/hunts" className="text-foreground" aria-label="lootibia — voltar">
          <Marca altura={22} />
        </Link>
        <Link
          href="/hunts"
          className="rounded-lg border px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Voltar ao painel
        </Link>
      </div>

      <h1 className="mb-8 text-2xl font-semibold tracking-tight">Configurações</h1>

      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-muted" />}>
        <Conteudo />
      </Suspense>
    </main>
  );
}

function Painel({
  titulo,
  explicacao,
  children,
}: {
  titulo: string;
  explicacao: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="entra rounded-xl border bg-card p-5 sm:p-6">
      <h2 className="text-sm font-semibold">{titulo}</h2>
      <p className="mb-4 mt-1 text-xs leading-relaxed text-muted-foreground">{explicacao}</p>
      {children}
    </section>
  );
}

async function Conteudo() {
  if (!hasEnvVars) return <p className="text-sm text-muted-foreground">Supabase não configurado.</p>;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return (
      <p className="text-sm">
        <Link href="/auth/login" className="text-primary underline underline-offset-4">
          Faça login
        </Link>{" "}
        para configurar.
      </p>
    );
  }

  const [{ data: dadosChars }, { data: dadosConfig }] = await Promise.all([
    supabase
      .from("usuario_personagem")
      .select("personagem(id, nome, mundo, vocacao, nivel, visto_em)"),
    supabase.from("config_mundo").select("mundo, preco_tc"),
  ]);

  const chars = ((dadosChars ?? []) as unknown as CharLigado[])
    .map((c) => c.personagem)
    .filter((p): p is NonNullable<CharLigado["personagem"]> => p !== null)
    .sort((a, b) => a.nome.localeCompare(b.nome));

  const precos = new Map(
    ((dadosConfig ?? []) as { mundo: string; preco_tc: number }[]).map((c) => [c.mundo, c.preco_tc]),
  );

  // Os mundos que importam são os dos seus chars. Um mundo com preço salvo mas
  // sem char (você trocou de servidor) continua aparecendo — apagar o preço
  // sozinho seria decidir por você.
  const mundos = [...new Set([...chars.map((c) => c.mundo).filter(Boolean), ...precos.keys()])] as string[];

  return (
    <div className="flex flex-col gap-5">
      <Painel
        titulo="Personagens"
        explicacao={
          <>
            Digite o nome e o resto vem da TibiaData — mundo, level e vocação. Serve para o{" "}
            <code className="rounded bg-muted px-1">/addhunt</code> do bot e para saber em que
            mundo ler o preço da Tibia Coin.
          </>
        }
      >
        <CadastrarPersonagem />

        {chars.length > 0 && (
          <ul className="mt-5 divide-y border-t pt-1">
            {chars.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
                  {c.nome
                    .split(" ")
                    .slice(0, 2)
                    .map((p) => p[0])
                    .join("")
                    .toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{c.nome}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[c.vocacao, c.nivel ? `level ${c.nivel}` : null, c.mundo]
                      .filter(Boolean)
                      .join(" · ") || "sem dados da TibiaData"}
                  </span>
                </span>
                <span className="ml-auto flex items-center gap-3">
                  {c.visto_em && (
                    <span className="hidden text-[11px] text-muted-foreground sm:inline">
                      lido em {new Date(c.visto_em).toLocaleDateString("pt-BR")}
                    </span>
                  )}
                  <form action={removerPersonagem}>
                    <input type="hidden" name="personagem_id" value={c.id} />
                    <button className="text-xs text-muted-foreground transition-colors hover:text-destructive">
                      remover
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Painel>

      <Painel
        titulo="Preço da Tibia Coin"
        explicacao={
          <>
            Por <b>mundo</b>, não por personagem: dois chars no mesmo servidor compartilham o
            preço, e assim ele não diverge em silêncio. É o que converte as metas em TC — nenhuma
            API publica preço de mercado, então o número é a sua estimativa.
          </>
        }
      >
        {mundos.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Cadastre um personagem acima e o mundo dele aparece aqui.
          </p>
        ) : (
          <ul className="divide-y">
            {mundos.map((m) => (
              <li key={m} className="flex flex-wrap items-center gap-3 py-3">
                <span className="text-sm font-semibold">{m}</span>
                <span className="ml-auto">
                  <PrecoDoMundo mundo={m} atual={precos.get(m) ?? null} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Painel>

      <Painel
        titulo="Conta"
        explicacao={
          <>
            Você entra como{" "}
            <b className="text-foreground">{usuarioDoEmail(auth.user.email) ?? "—"}</b>.
          </>
        }
      >
        <Link
          href="/auth/definir-senha"
          className="inline-block rounded-lg border px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Trocar a senha
        </Link>
      </Painel>

      <Painel
        titulo="Discord"
        explicacao={
          <>
            Liga sua conta ao bot: <code className="rounded bg-muted px-1">/addhunt</code> passa a
            gravar aqui e <code className="rounded bg-muted px-1">/viewstats</code> lê daqui. O
            vínculo também entrega ao bot o seu fuso horário — sem ele não dá para saber a que dia
            de Tibia cada sessão pertence.
          </>
        }
      >
        <VinculoDiscord />
      </Painel>
    </div>
  );
}
