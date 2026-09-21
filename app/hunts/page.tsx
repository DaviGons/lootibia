import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { resumirHunts, type SessaoRotulada } from "@/lib/huntAgregado";
import { semanaTibia, diaTibia } from "@/lib/periodo";
import { rashidEm } from "@/lib/rashid";
import { progressoDaMeta, rotuloDaMeta, type UnidadeDaMeta } from "@/lib/meta";
import { FormularioImportacao } from "./formulario";
import { apagarSessao } from "./acoes";
import { hasEnvVars } from "@/lib/utils";
import { spriteDe } from "@/lib/sprites";
import { usuarioDoEmail } from "@/lib/conta";
import { Marca } from "@/components/marca";
import { Lateral, type PastaNaLateral } from "@/components/lateral";
import { FaixaDoDia } from "@/components/faixa-do-dia";
import { MoverSessao } from "@/components/mover-sessao";

// Next 16 com Cache Components: ler `cookies()` (o que o cliente Supabase faz)
// e `searchParams` fora de um <Suspense> é erro de build. A tela inteira depende
// dos dois — qual pasta está aberta vem da URL —, então o app todo streama atrás
// de uma fronteira só, e não uma por seção: são os mesmos dados, e duas
// fronteiras seriam duas viagens ao banco.

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
  pasta_id: number | null;
  spot: { nome: string } | null;
}

interface LinhaDetalhe {
  sessao_id: number;
  quantidade: number;
  monstro: { nome: string } | null;
}

interface LinhaPasta {
  id: number;
  nome: string;
  meta_valor: number | null;
  meta_unidade: UnidadeDaMeta | null;
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
    taxasExibidas: { rawXpPorHora: null, xpPorHora: null, damagePorHora: null, healingPorHora: null },
    camposIgnorados: {},
    rotulo: l.spot?.nome,
  };
}

export default function PaginaHunts({
  searchParams,
}: {
  searchParams: Promise<{ pasta?: string }>;
}) {
  return (
    <Suspense fallback={<Esqueleto />}>
      <App searchParams={searchParams} />
    </Suspense>
  );
}

/** O que a tela mostra antes de o banco responder. */
function Esqueleto() {
  return (
    <div className="flex">
      <div className="h-dvh w-[238px] shrink-0 border-r bg-secondary/40 max-lg:hidden" />
      <div className="flex-1 p-7">
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
    </div>
  );
}

/** Casca mínima para quando não dá para mostrar dado nenhum. */
function Sozinho({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <Marca altura={24} />
      <div className="mt-8">{children}</div>
    </main>
  );
}

async function App({ searchParams }: { searchParams: Promise<{ pasta?: string }> }) {
  if (!hasEnvVars) {
    return (
      <Sozinho>
        <Aviso>
          <p className="font-medium">Supabase ainda não configurado.</p>
          <p className="mt-1 text-muted-foreground">
            Preencha <code className="rounded bg-muted px-1">NEXT_PUBLIC_SUPABASE_URL</code> e a
            chave publicável no <code className="rounded bg-muted px-1">.env.local</code>.
          </p>
        </Aviso>
      </Sozinho>
    );
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return (
      <Sozinho>
        <Aviso>
          <Link href="/auth/login" className="font-medium text-primary underline underline-offset-4">
            Faça login
          </Link>{" "}
          para ver suas sessões — a RLS do Supabase bloqueia leitura sem usuário.
        </Aviso>
      </Sozinho>
    );
  }

  const selecionada = (await searchParams).pasta ?? null;

  // Quatro consultas independentes em paralelo. Sequenciais seriam quatro idas
  // ao banco somadas, e nenhuma depende do resultado da outra.
  const [{ data: dadosSessoes, error }, { data: dadosPastas }, { data: dadosConfig }, { data: dadosChars }] =
    await Promise.all([
      supabase
        .from("sessao")
        .select("id, inicio, duracao_s, raw_xp, xp, loot, supplies, damage, healing, pasta_id, spot(nome)")
        .order("inicio", { ascending: false })
        .limit(500),
      supabase.from("pasta").select("id, nome, meta_valor, meta_unidade").order("ordem").order("id"),
      supabase.from("config_mundo").select("mundo, preco_tc"),
      supabase.from("usuario_personagem").select("personagem(nome, mundo)"),
    ]);

  if (error) {
    return (
      <Sozinho>
        <Aviso>
          <p className="font-medium text-destructive">Erro ao ler o banco: {error.message}</p>
          <p className="mt-1 text-muted-foreground">
            Rodou <code className="rounded bg-muted px-1">0003_pastas_e_metas.sql</code> no SQL
            Editor?
          </p>
        </Aviso>
      </Sozinho>
    );
  }

  const todas = (dadosSessoes ?? []) as unknown as LinhaSessao[];
  const pastas = (dadosPastas ?? []) as LinhaPasta[];
  const chars = (dadosChars ?? []) as unknown as { personagem: { nome: string; mundo: string | null } | null }[];
  const mundo = chars.map((c) => c.personagem?.mundo).find(Boolean) ?? null;
  const precoTc =
    ((dadosConfig ?? []) as { mundo: string; preco_tc: number }[]).find((c) => c.mundo === mundo)
      ?.preco_tc ?? null;

  // Agregado por pasta para a lateral. Feito aqui, em memória, e não com um
  // `group by` no banco: as sessões já vieram, e uma segunda consulta para
  // contar o que está na mão seria tráfego à toa.
  const porPasta = new Map<number, { hunts: number; profit: number }>();
  for (const s of todas) {
    if (s.pasta_id === null) continue;
    const a = porPasta.get(s.pasta_id) ?? { hunts: 0, profit: 0 };
    a.hunts += 1;
    a.profit += s.loot - s.supplies;
    porPasta.set(s.pasta_id, a);
  }

  const pastasNaLateral: PastaNaLateral[] = pastas.map((p) => ({
    id: p.id,
    nome: p.nome,
    hunts: porPasta.get(p.id)?.hunts ?? 0,
    profit: porPasta.get(p.id)?.profit ?? 0,
    meta_valor: p.meta_valor,
    meta_unidade: p.meta_unidade,
  }));

  const semPasta = todas.filter((s) => s.pasta_id === null).length;

  // O recorte que a lateral pediu.
  const pastaAberta = selecionada && selecionada !== "sem" ? Number(selecionada) : null;
  const linhas =
    selecionada === "sem"
      ? todas.filter((s) => s.pasta_id === null)
      : pastaAberta !== null
        ? todas.filter((s) => s.pasta_id === pastaAberta)
        : todas;

  const pastaAtual = pastas.find((p) => p.id === pastaAberta) ?? null;
  const titulo = pastaAtual?.nome ?? (selecionada === "sem" ? "Sem pasta" : "Todas as hunts");

  const { data: dadosDetalhe } = await supabase
    .from("sessao_monstro")
    .select("sessao_id, quantidade, monstro(nome)")
    .in("sessao_id", linhas.length > 0 ? linhas.slice(0, 200).map((l) => l.id) : [-1]);
  const detalhes = (dadosDetalhe ?? []) as unknown as LinhaDetalhe[];

  const resumo = resumirHunts(linhas.map((l) => paraAgregado(l, detalhes)));
  const maiorContagem = resumo.monstrosMortos[0]?.quantidade ?? 1;

  const meta =
    pastaAtual?.meta_valor && pastaAtual.meta_unidade
      ? { valor: pastaAtual.meta_valor, unidade: pastaAtual.meta_unidade }
      : null;
  const progresso = meta ? progressoDaMeta(meta, resumo.profit, precoTc, resumo.hunts) : null;

  return (
    <div className="flex">
      <Lateral
        pastas={pastasNaLateral}
        selecionada={selecionada}
        totalDeHunts={todas.length}
        semPasta={semPasta}
        precoTc={precoTc}
        usuario={usuarioDoEmail(auth.user.email)}
      />

      <main className="min-w-0 flex-1 pb-20">
        {/* `pl-16` no mobile abre espaco para o botao da gaveta, que e `fixed`
            e nao ocupa lugar no fluxo. */}
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b bg-background/90 py-3 pl-16 pr-4 backdrop-blur lg:pl-6 lg:pr-6">
          <h1 className="text-[15px] font-semibold tracking-tight">{titulo}</h1>
          <span className="text-xs text-muted-foreground">
            {linhas.length} {linhas.length === 1 ? "hunt" : "hunts"}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <a
              href="#importar"
              className="rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-[filter] hover:brightness-110"
            >
              Importar sessão
            </a>
          </div>
        </header>

        <FaixaDoDia rashid={rashidEm()} mundo={mundo} />

        <div className="flex flex-col gap-10 px-4 py-6 sm:px-6 lg:px-6">
          {linhas.length === 0 ? (
            <Aviso>
              <p className="font-medium">
                {selecionada ? "Nenhuma hunt nesta pasta ainda." : "Nenhuma hunt importada ainda."}
              </p>
              <p className="mt-1 text-muted-foreground">
                Cole o texto do Hunt Analyser abaixo — o app calcula o resto.
              </p>
            </Aviso>
          ) : (
            <>
              {/* Figura-herói: um número por tela, e é o que o jogador vem ver. */}
              <section className="entra">
                <h2 className="text-xs font-medium text-muted-foreground">
                  {pastaAtual ? "Profit da pasta" : "Profit acumulado"}
                </h2>
                <p className="mt-1 text-5xl font-semibold tracking-tight sm:text-6xl">
                  {num(resumo.profit)}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {resumo.hunts} {resumo.hunts === 1 ? "hunt" : "hunts"} · {horas(resumo.segundos)}
                  {resumo.porHora ? ` · ${num(resumo.porHora.profit)}/h` : ""}
                </p>
              </section>

              {meta && <Meta meta={meta} progresso={progresso} precoTc={precoTc} />}

              <section>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Tile i={0} rotulo="Loot" valor={compacto(resumo.loot)} nota={resumo.porHora ? `${num(resumo.porHora.loot)}/h` : undefined} />
                  <Tile
                    i={1}
                    rotulo="Supplies"
                    valor={compacto(resumo.supplies)}
                    nota={resumo.porHora ? `${num(resumo.porHora.supplies)}/h` : undefined}
                  />
                  <Tile i={2} rotulo="Tempo caçado" valor={horas(resumo.segundos)} nota={`${resumo.hunts} sessão(ões)`} />
                  <Tile i={3} rotulo="XP" valor={compacto(resumo.xp)} nota={resumo.porHora ? `${num(resumo.porHora.xp)}/h` : undefined} />
                  <Tile i={4} rotulo="XP Raw" valor={compacto(resumo.rawXp)} nota={resumo.porHora ? `${num(resumo.porHora.rawXp)}/h` : undefined} />
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

              <div className="grid gap-10 xl:grid-cols-[1.15fr_1fr]">
                {resumo.monstrosMortos.length > 0 && (
                  <section>
                    <h2 className="mb-4 text-sm font-medium text-muted-foreground">Mobs mortos</h2>
                    {/* Série única: sem legenda. O valor fica na ponta da barra. */}
                    <ul className="flex flex-col gap-2.5">
                      {resumo.monstrosMortos.map((m, i) => (
                        <li
                          key={m.nome}
                          className="entra grid grid-cols-[minmax(7rem,11rem)_1fr_3.5rem] items-center gap-3"
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
                                // bicho de evento nao estao la.
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

                {resumo.spotsMaisCacados.length > 0 && (
                  <section>
                    <h2 className="mb-4 text-sm font-medium text-muted-foreground">
                      Hunts mais caçadas
                    </h2>
                    <div className="overflow-hidden rounded-xl border bg-card">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-muted-foreground">
                            <th className="px-4 py-2.5 font-medium">Spot</th>
                            <th className="px-4 py-2.5 font-medium">Hunts</th>
                            <th className="px-4 py-2.5 text-right font-medium">Profit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resumo.spotsMaisCacados.map((s, i) => (
                            <tr
                              key={s.rotulo}
                              className="entra border-b transition-colors last:border-0 hover:bg-muted/50"
                              style={{ "--i": i } as React.CSSProperties}
                            >
                              <td className="whitespace-nowrap px-4 py-2.5 font-medium">{s.rotulo}</td>
                              <td className="px-4 py-2.5 tabular-nums">{s.hunts}</td>
                              <td
                                className={`px-4 py-2.5 text-right tabular-nums ${s.profit < 0 ? "text-destructive" : ""}`}
                              >
                                {num(s.profit)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {resumo.huntsSemRotulo > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {resumo.huntsSemRotulo} sessão(ões) sem nome de spot ficam de fora.
                      </p>
                    )}
                  </section>
                )}
              </div>

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
                        <th className="px-4 py-2.5 font-medium">Spot</th>
                        <th className="px-4 py-2.5 font-medium">Pasta</th>
                        <th className="px-4 py-2.5 font-medium">Duração</th>
                        <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                        <th className="px-4 py-2.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {linhas.slice(0, 200).map((l, i) => {
                        const dia = diaTibia(new Date(l.inicio));
                        const balance = l.loot - l.supplies;
                        return (
                          <tr
                            key={l.id}
                            className="entra group border-b transition-colors last:border-0 hover:bg-muted/50"
                            style={{ "--i": i } as React.CSSProperties}
                          >
                            <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                              {new Date(l.inicio).toLocaleString("pt-BR")}
                            </td>
                            <td
                              className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted-foreground"
                              title={semanaTibia(dia)}
                            >
                              {dia}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5">{l.spot?.nome ?? "—"}</td>
                            <td className="px-4 py-1.5">
                              <MoverSessao sessaoId={l.id} pastaId={l.pasta_id} pastas={pastas} />
                            </td>
                            <td className="px-4 py-2.5 tabular-nums">{horas(l.duracao_s)}</td>
                            <td
                              className={`px-4 py-2.5 text-right font-medium tabular-nums ${balance < 0 ? "text-destructive" : ""}`}
                            >
                              {num(balance)}
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
            </>
          )}

          <section id="importar" className="entra scroll-mt-20 rounded-xl border bg-card p-5 sm:p-6">
            <h2 className="text-sm font-medium">Importar sessão</h2>
            <p className="mb-4 mt-0.5 text-xs text-muted-foreground">
              Cole o que o Hunt Analyser copiou. As taxas por hora do jogo são ignoradas — os
              números são recalculados a partir dos totais.
            </p>
            <FormularioImportacao />
          </section>

          <footer className="text-xs leading-relaxed text-muted-foreground">
            Tibia e todos os produtos relacionados são © CipSoft GmbH. Dados de tibia.com e do
            TibiaWiki.
          </footer>
        </div>
      </main>
    </div>
  );
}

/**
 * Medidor da meta. Trilho e preenchimento são passos do MESMO matiz, que é o
 * que a paleta já traz em `--dado` / `--dado-trilho`.
 *
 * Sem preço de TC configurado, uma meta em TC não tem alvo em gold — e aí a
 * barra some e o texto diz o que fazer, em vez de mostrar 0% como se a pessoa
 * não tivesse caçado nada.
 */
function Meta({
  meta,
  progresso,
  precoTc,
}: {
  meta: { valor: number; unidade: UnidadeDaMeta };
  progresso: ReturnType<typeof progressoDaMeta>;
  precoTc: number | null;
}) {
  if (!progresso) {
    return (
      <section className="entra rounded-xl border bg-card p-4 text-sm">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Meta
        </span>{" "}
        <span className="font-semibold">{rotuloDaMeta(meta)}</span>
        <p className="mt-1 text-xs text-muted-foreground">
          Falta dizer quanto vale a Tibia Coin no seu mundo —{" "}
          <Link href="/config" className="text-primary underline underline-offset-4">
            configure o preço
          </Link>{" "}
          para acompanhar o progresso.
        </p>
      </section>
    );
  }

  return (
    <section className="entra rounded-xl border bg-card p-4">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Meta
        </span>
        <span className="text-sm font-semibold">{rotuloDaMeta(meta)}</span>
        {meta.unidade === "tc" && precoTc && (
          <span className="text-xs text-muted-foreground">
            ≈ {num(progresso.alvoEmGp)} gp · TC a {num(precoTc)}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {progresso.bateu ? (
            <span className="font-medium text-foreground">meta batida</span>
          ) : (
            <>
              faltam{" "}
              <span className="font-medium text-foreground">
                {num(progresso.falta)} {meta.unidade === "tc" ? "TC" : "gp"}
              </span>
            </>
          )}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-[hsl(var(--dado-trilho))]">
        <span
          className="cresce block h-full rounded-r-[4px] bg-[hsl(var(--dado))]"
          style={{ width: `${Math.max(progresso.fracao * 100, progresso.fracao > 0 ? 1.5 : 0)}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">
          {Math.round(progresso.fracaoCrua * 100)}%
        </span>
        {progresso.huntsRestantes !== null && progresso.huntsRestantes > 0 && (
          <> · no ritmo atual, ~{progresso.huntsRestantes} hunts para fechar</>
        )}
      </p>
    </section>
  );
}
