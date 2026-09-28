import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hasEnvVars } from "@/lib/utils";
import { DIAS_RECENTES, horasPorSemana, somarRitmo, type SessaoDeXp } from "@/lib/level";
import { Topo } from "../topo";
import { PrevisaoDeLevel, type CharDaPrevisao } from "./previsao";

/**
 * Teto de linhas que o PostgREST do Supabase devolve por consulta (`max_rows`,
 * 1.000 por padrão). As sessões vêm da mais nova para a mais velha, então o
 * ritmo recente continua certo; só o "todas as hunts" passa a ser "as últimas
 * 1.000", e a tela avisa.
 */
const LIMITE_SESSOES = 1000;

export default function PaginaPreverLevel() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <Topo voltarPara="/ferramentas" rotulo="Ferramentas" />
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Prever level</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        O ritmo vem das suas hunts importadas: XP somada dividida pelas horas somadas.
      </p>

      {/* Ler `cookies()` fora de <Suspense> é erro de build com Cache Components. */}
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-muted" />}>
        <Conteudo />
      </Suspense>
    </main>
  );
}

interface LinhaChar {
  vocacao: string | null;
  nivel: number | null;
  visto_em: string | null;
  personagem: { id: number; nome: string } | null;
}

interface LinhaSessao {
  personagem_id: number;
  inicio: string;
  duracao_s: number;
  xp: number;
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
        para prever o level.
      </p>
    );
  }

  // Só as quatro colunas que a conta usa: a lista de hunts carrega bem mais.
  const [{ data: dadosChars }, { data: dadosSessoes, error }] = await Promise.all([
    supabase.from("usuario_personagem").select("vocacao, nivel, visto_em, personagem(id, nome)"),
    supabase
      .from("sessao")
      .select("personagem_id, inicio, duracao_s, xp")
      .not("personagem_id", "is", null)
      .order("inicio", { ascending: false })
      .limit(LIMITE_SESSOES),
  ]);

  if (error) {
    return <p className="text-sm text-destructive">Erro ao ler as hunts: {error.message}</p>;
  }

  // Depois das leituras: com Cache Components, o relógio só pode ser lido
  // quando a página já é dinâmica.
  const agora = new Date();
  const desde = new Date(agora.getTime() - DIAS_RECENTES * 86_400_000);

  const sessoes = (dadosSessoes ?? []) as LinhaSessao[];
  const porChar = new Map<number, SessaoDeXp[]>();
  for (const s of sessoes) {
    const lista = porChar.get(s.personagem_id) ?? [];
    lista.push({ inicio: new Date(s.inicio), duracaoS: s.duracao_s, xp: s.xp });
    porChar.set(s.personagem_id, lista);
  }

  const chars: CharDaPrevisao[] = ((dadosChars ?? []) as unknown as LinhaChar[])
    .filter((c): c is LinhaChar & { personagem: { id: number; nome: string } } => c.personagem !== null)
    .map((c) => {
      const suas = porChar.get(c.personagem.id) ?? [];
      return {
        id: c.personagem.id,
        nome: c.personagem.nome,
        vocacao: c.vocacao,
        nivel: c.nivel,
        vistoEm: c.visto_em,
        recente: somarRitmo(suas, desde),
        todas: somarRitmo(suas),
        horasPorSemana: horasPorSemana(suas, agora),
      };
    })
    // Quem tem mais hunts primeiro: é o char que a pessoa mais quer prever.
    .sort((a, b) => b.todas.hunts - a.todas.hunts || a.nome.localeCompare(b.nome));

  if (chars.length === 0) {
    return (
      <p className="rounded-xl border bg-card p-5 text-sm">
        Cadastre um personagem em{" "}
        <Link href="/config" className="text-primary underline underline-offset-4">
          Configurações
        </Link>{" "}
        para prever o level dele.
      </p>
    );
  }

  return (
    <PrevisaoDeLevel
      chars={chars}
      agora={agora.toISOString()}
      truncado={sessoes.length >= LIMITE_SESSOES}
    />
  );
}
