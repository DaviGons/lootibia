import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { resumirHunts, type SessaoRotulada } from "@/lib/huntAgregado";
import { semanaTibia, diaTibia } from "@/lib/periodo";
import { FormularioImportacao, VinculoDiscord } from "./formulario";
import { apagarSessao } from "./acoes";
import { hasEnvVars } from "@/lib/utils";
import { LogoutButton } from "@/components/logout-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { spriteDe } from "@/lib/sprites";
import { Marca } from "@/components/marca";
import { usuarioDoEmail } from "@/lib/conta";

// Next 16 com Cache Components: ler `cookies()` (o que o cliente Supabase faz)
// fora de um <Suspense> é erro de build, e `export const dynamic` não existe
// mais. O shell estático é o cabeçalho e o formulário; tudo que depende do
// usuário logado streama atrás da fronteira.

interface LinhaSessao {
  id: number;
  inicio: string;
  duracao_s: number;
  raw_xp: number;
  xp: number;
  loot: number;
  supplies: number;
  damage: number;
  healing: number;
  spot: { nome: string } | null;
}

interface LinhaDetalhe {
  sessao_id: number;
  quantidade: number;
  monstro: { nome: string } | null;
}

const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

/** 1.284 / 12 mil / 4,2 mi — para caber no tile sem virar sopa de dígitos. */
function compacto(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000)
    return `${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 10_000)
    return `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return num(n);
}

const horas = (s: number) =>
  `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, "0")}`;

function Tile({ rotulo, valor, nota, i }: { rotulo: string; valor: string; nota?: string; i: number }) {
  return (
    <div
      className="entra rounded-xl border bg-card p-4 transition-colors duration-300 hover:border-primary/40"
      style={{ "--i": i } as React.CSSProperties}
    >
      <div className="text-xs font-medium tracking-wide text-muted-foreground">{rotulo}</div>
      {/* Valor grande usa figuras proporcionais; tabular só em coluna de tabela. */}
      <div className="mt-1 text-2xl font-semibold">{valor}</div>
      {nota && <div className="mt-0.5 text-xs text-muted-foreground">{nota}</div>}
    </div>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <div className="entra rounded-xl border border-primary/30 bg-primary/5 p-5 text-sm leading-relaxed">
      {children}
    </div>
  );
}

function paraAgregado(l: LinhaSessao, detalhes: LinhaDetalhe[] = []): SessaoRotulada {
  return {
    inicio: l.inicio,
    fim: l.inicio,
    duracaoSegundos: l.duracao_s,
    duracaoExibidaSegundos: null,
    rawXpGain: l.raw_xp,
    xpGain: l.xp,
    loot: l.loot,
    supplies: l.supplies,
    balance: l.loot - l.supplies,
    damage: l.damage,
    healing: l.healing,
    monstrosMortos: detalhes
      .filter((d) => d.sessao_id === l.id && d.monstro)
      .map((d) => ({ nome: d.monstro!.nome, quantidade: d.quantidade })),
    itensLootados: [],
    taxasExibidas: {
      rawXpPorHora: null,
      xpPorHora: null,
      damagePorHora: null,
      healingPorHora: null,
    },
    camposIgnorados: {},
    rotulo: l.spot?.nome,
  };
}

/** Usuario + sair. Le cookie, entao vive atras de um <Suspense>. */
async function BarraConta() {
  if (!hasEnvVars) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  // O e-mail e sintetico (ver lib/conta.ts) e nao serve para ninguem ler.
  const usuario = usuarioDoEmail(data?.claims?.email as string | undefined);
  if (!usuario) return null;
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/auth/definir-senha"
        className="hidden text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline sm:inline"
      >
        {usuario}
      </Link>
      <LogoutButton />
    </div>
  );
}

async function Painel() {
  if (!hasEnvVars) {
    return (
      <Aviso>
        <p className="font-medium">Supabase ainda não configurado.</p>
        <p className="mt-1 text-muted-foreground">
          Preencha <code className="rounded bg-muted px-1">NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
          <code className="rounded bg-muted px-1">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> no{" "}
          <code className="rounded bg-muted px-1">.env.local</code>, depois rode{" "}
          <code className="rounded bg-muted px-1">supabase/migrations/0001_schema.sql</code>.
        </p>
      </Aviso>
    );
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    return (
      <Aviso>
        <Link href="/auth/login" className="font-medium text-primary underline underline-offset-4">
          Faça login
        </Link>{" "}
        para importar e ver suas sessões — a RLS do Supabase bloqueia leitura sem usuário.
      </Aviso>
    );
  }

  const { data, error } = await supabase
    .from("sessao")
    .select("id, inicio, duracao_s, raw_xp, xp, loot, supplies, damage, healing, spot(nome)")
    .order("inicio", { ascending: false })
    .limit(200);

  if (error) {
    return (
      <Aviso>
        <p className="font-medium text-destructive">Erro ao ler o banco: {error.message}</p>
        <p className="mt-1 text-muted-foreground">
          O schema já foi aplicado? Rode{" "}
          <code className="rounded bg-muted px-1">supabase/migrations/0001_schema.sql</code> no SQL
          Editor.
        </p>
      </Aviso>
    );
  }

  const linhas = (data ?? []) as unknown as LinhaSessao[];
  const semanaAtual = semanaTibia(diaTibia(new Date()));
  const daSemana = linhas.filter((l) => semanaTibia(diaTibia(new Date(l.inicio))) === semanaAtual);

  // Detalhe só das sessões da semana: puxar os ~13 registros de cada uma das 200
  // sessões listadas seria tráfego à toa.
  const { data: dadosDetalhe } = await supabase
    .from("sessao_monstro")
    .select("sessao_id, quantidade, monstro(nome)")
    .in("sessao_id", daSemana.length > 0 ? daSemana.map((l) => l.id) : [-1]);
  const detalhes = (dadosDetalhe ?? []) as unknown as LinhaDetalhe[];

  const resumo = resumirHunts(daSemana.map((l) => paraAgregado(l, detalhes)));
  const geral = resumirHunts(linhas.map((l) => paraAgregado(l)));

  if (linhas.length === 0) {
    return (
      <Aviso>
        <p className="font-medium">Nenhuma hunt importada ainda.</p>
        <p className="mt-1 text-muted-foreground">
          Cole o texto do Hunt Analyser abaixo — o app calcula o resto.
        </p>
      </Aviso>
    );
  }

  const maiorContagem = resumo.monstrosMortos[0]?.quantidade ?? 1;

  return (
    <div className="flex flex-col gap-12">
      {/* Figura-herói: um número por tela, e é o que o jogador vem ver. */}
      <section className="entra">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-sm font-medium text-muted-foreground">Profit da semana</h2>
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {semanaAtual}
          </span>
        </div>
        <p className="mt-1 text-5xl font-semibold tracking-tight sm:text-6xl">{num(resumo.profit)}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {resumo.hunts} {resumo.hunts === 1 ? "hunt" : "hunts"} · {horas(resumo.segundos)}
          {resumo.porHora ? ` · ${num(resumo.porHora.profit)}/h` : ""}
        </p>
      </section>

      {resumo.porHora && (
        <section>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Tile i={0} rotulo="Loot" valor={compacto(resumo.loot)} nota={`${num(resumo.porHora.loot)}/h`} />
            <Tile
              i={1}
              rotulo="Supplies"
              valor={compacto(resumo.supplies)}
              nota={`${num(resumo.porHora.supplies)}/h · ${num(resumo.suppliesPorHunt ?? 0)}/hunt`}
            />
            <Tile
              i={2}
              rotulo="Tempo caçado"
              valor={horas(resumo.segundos)}
              nota={`${resumo.hunts} sessão(ões)`}
            />
            <Tile i={3} rotulo="XP" valor={compacto(resumo.xp)} nota={`${num(resumo.porHora.xp)}/h`} />
            <Tile
              i={4}
              rotulo="XP Raw"
              valor={compacto(resumo.rawXp)}
              nota={`${num(resumo.porHora.rawXp)}/h`}
            />
            <Tile
              i={5}
              rotulo="Bônus de XP"
              valor={`+${((resumo.xp / Math.max(resumo.rawXp, 1) - 1) * 100).toFixed(0)}%`}
              nota="XP sobre XP Raw"
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Toda taxa é Σ total ÷ Σ horas, nunca a média das médias por sessão.
          </p>
        </section>
      )}

      {resumo.monstrosMortos.length > 0 && (
        <section>
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">Mobs mortos na semana</h2>
          {/* Série única: sem legenda. O valor fica na ponta da barra. */}
          <ul className="flex flex-col gap-2.5">
            {resumo.monstrosMortos.map((m, i) => (
              <li
                key={m.nome}
                className="entra grid grid-cols-[minmax(8rem,13rem)_1fr_3.5rem] items-center gap-3"
                style={{ "--i": i } as React.CSSProperties}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center">
                    {spriteDe(m.nome) ? (
                      // <img> de proposito, sem next/image: o static.tibia.com
                      // devolve 403 para quem nao e navegador, e a otimizacao de
                      // imagem da Vercel buscaria a partir do servidor.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={spriteDe(m.nome)}
                        alt=""
                        width={32}
                        height={32}
                        loading="lazy"
                        decoding="async"
                        className="max-h-8 w-auto opacity-90 transition-opacity duration-200 hover:opacity-100"
                      />
                    ) : (
                      // A biblioteca do tibia.com cobre ~718 criaturas; boss e
                      // bicho de evento nao estao la. Marcador discreto, para
                      // ler como "sem sprite" e nao como imagem quebrada.
                      <span
                        aria-hidden
                        title="sem sprite na biblioteca do tibia.com"
                        className="flex h-7 w-7 items-center justify-center rounded-md border border-dashed text-[10px] uppercase text-muted-foreground/70"
                      >
                        {m.nome.slice(0, 1)}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-sm capitalize" title={m.nome}>
                    {m.nome}
                  </span>
                </span>
                <span className="h-2.5 rounded-sm bg-[hsl(var(--dado-trilho))]">
                  <span
                    className="cresce block h-full rounded-r-[4px]"
                    style={
                      {
                        width: `${Math.max((m.quantidade / maiorContagem) * 100, 1.5)}%`,
                        backgroundColor: "hsl(var(--dado))",
                        "--i": i,
                      } as React.CSSProperties
                    }
                  />
                </span>
                <span className="text-right text-sm tabular-nums text-muted-foreground">
                  {num(m.quantidade)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {geral.spotsMaisCacados.length > 0 && (
        <section>
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">Hunts mais caçadas</h2>
          <div className="overflow-hidden rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Spot</th>
                  <th className="px-4 py-2.5 font-medium">Hunts</th>
                  <th className="px-4 py-2.5 font-medium">Tempo</th>
                  <th className="px-4 py-2.5 text-right font-medium">Profit</th>
                </tr>
              </thead>
              <tbody>
                {geral.spotsMaisCacados.map((s, i) => (
                  <tr
                    key={s.rotulo}
                    className="entra border-b transition-colors last:border-0 hover:bg-muted/50"
                    style={{ "--i": i } as React.CSSProperties}
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium">{s.rotulo}</td>
                    <td className="px-4 py-2.5 tabular-nums">{s.hunts}</td>
                    <td className="px-4 py-2.5 tabular-nums">{horas(s.segundos)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{num(s.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {geral.huntsSemRotulo > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {geral.huntsSemRotulo} sessão(ões) sem nome de spot ficam de fora desta tabela.
            </p>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">
          Sessões <span className="tabular-nums">({linhas.length})</span>
        </h2>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Início</th>
                <th className="px-4 py-2.5 font-medium">Dia do jogo</th>
                <th className="px-4 py-2.5 font-medium">Semana</th>
                <th className="px-4 py-2.5 font-medium">Spot</th>
                <th className="px-4 py-2.5 font-medium">Duração</th>
                <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => {
                const dia = diaTibia(new Date(l.inicio));
                return (
                  <tr
                    key={l.id}
                    className="entra group border-b transition-colors last:border-0 hover:bg-muted/50"
                    style={{ "--i": i } as React.CSSProperties}
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                      {new Date(l.inicio).toLocaleString("pt-BR")}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted-foreground">
                      {dia}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                      {semanaTibia(dia)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">{l.spot?.nome ?? "—"}</td>
                    <td className="px-4 py-2.5 tabular-nums">{horas(l.duracao_s)}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      {num(l.loot - l.supplies)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <form action={apagarSessao}>
                        <input type="hidden" name="id" value={l.id} />
                        <button className="text-xs text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover:opacity-100">
                          apagar
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function PaginaHunts() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-16">
      <header className="entra mb-12 flex items-start justify-between gap-4">
        <div>
          {/* O <h1> continua sendo o nome do produto: a Marca carrega o
              aria-label, então o leitor de tela ouve "lootibia", não "imagem". */}
          <h1>
            <Marca altura={26} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Analisador de hunts — a semana do jogo vira às 10:00 de Berlim, no server save.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Suspense fallback={null}>
            <BarraConta />
          </Suspense>
          <ThemeSwitcher />
        </div>
      </header>

      <Suspense
        fallback={
          <div className="flex flex-col gap-3">
            <div className="h-24 animate-pulse rounded-xl bg-muted" />
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="h-24 animate-pulse rounded-xl bg-muted" />
              <div className="h-24 animate-pulse rounded-xl bg-muted" />
              <div className="h-24 animate-pulse rounded-xl bg-muted" />
            </div>
          </div>
        }
      >
        <Painel />
      </Suspense>

      <section className="entra mt-12 rounded-xl border bg-card p-5 sm:p-6">
        <h2 className="text-sm font-medium">Importar sessão</h2>
        <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
          Cole o que o Hunt Analyser copiou. As taxas por hora do jogo são ignoradas — os números
          são recalculados a partir dos totais.
        </p>
        <FormularioImportacao />
      </section>

      <section className="entra mt-6 rounded-xl border bg-card p-5 sm:p-6">
        <h2 className="text-sm font-medium">Vincular Discord</h2>
        <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
          Liga sua conta ao bot: <code className="rounded bg-muted px-1">/addhunt</code> passa a
          gravar aqui e <code className="rounded bg-muted px-1">/viewstats</code> lê daqui. O
          vínculo também entrega ao bot o seu fuso horário — sem ele não dá para saber a que dia
          de Tibia cada sessão pertence.
        </p>
        <VinculoDiscord />
      </section>

      <footer className="mt-16 text-xs leading-relaxed text-muted-foreground">
        Tibia e todos os produtos relacionados são © CipSoft GmbH. Dados de tibia.com e do
        TibiaWiki.
      </footer>
    </main>
  );
}
