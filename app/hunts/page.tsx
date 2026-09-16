import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { resumirHunts, type SessaoRotulada } from "@/lib/huntAgregado";
import { semanaTibia, diaTibia } from "@/lib/periodo";
import { FormularioImportacao } from "./formulario";
import { apagarSessao } from "./acoes";
import { hasEnvVars } from "@/lib/utils";

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

const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const horas = (s: number) =>
  `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, "0")}`;

function Metrica({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="rounded border p-3">
      <div className="text-xs uppercase tracking-wide opacity-60">{rotulo}</div>
      <div className="text-xl font-semibold tabular-nums">{valor}</div>
      {nota && <div className="text-xs opacity-60">{nota}</div>}
    </div>
  );
}

/** Converte a linha do banco no formato da agregação. `balance` é derivado. */
function paraAgregado(l: LinhaSessao): SessaoRotulada {
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
    monstrosMortos: [],
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

async function Painel() {
  // `hasEnvVars` tambem rejeita os placeholders do .env.example.
  if (!hasEnvVars) {
    return (
      <div className="rounded border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">Supabase ainda nao configurado.</p>
        <p className="mt-1 opacity-80">
          Copie <code>.env.example</code> para <code>.env.local</code> e preencha{" "}
          <code>NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
          <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> com os dados do projeto. Depois rode{" "}
          <code>supabase/migrations/0001_schema.sql</code> no SQL Editor.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    return (
      <p className="text-sm">
        <Link href="/auth/login" className="underline">
          Faça login
        </Link>{" "}
        para importar e ver suas sessões — a RLS do Supabase bloqueia leitura sem usuário.
      </p>
    );
  }

  const { data, error } = await supabase
    .from("sessao")
    .select("id, inicio, duracao_s, raw_xp, xp, loot, supplies, damage, healing, spot(nome)")
    .order("inicio", { ascending: false })
    .limit(200);

  if (error) {
    return (
      <div className="text-sm">
        <p className="text-red-600">Erro ao ler o banco: {error.message}</p>
        <p className="mt-2 opacity-70">
          O schema já foi aplicado? Rode <code>supabase/migrations/0001_schema.sql</code> no SQL
          Editor do Supabase.
        </p>
      </div>
    );
  }

  const linhas = (data ?? []) as unknown as LinhaSessao[];

  // Semana corrente pela regra do server save (lib/periodo.ts), não pelo
  // calendário civil.
  const semanaAtual = semanaTibia(diaTibia(new Date()));
  const daSemana = linhas.filter((l) => semanaTibia(diaTibia(new Date(l.inicio))) === semanaAtual);

  const resumo = resumirHunts(daSemana.map(paraAgregado));
  const geral = resumirHunts(linhas.map(paraAgregado));

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-1 font-semibold">Acumulado da semana {semanaAtual}</h2>
        <p className="mb-3 text-xs opacity-60">
          {resumo.hunts} hunt(s) · {horas(resumo.segundos)} · o dia do jogo vira às 10:00 de Berlim
        </p>
        {resumo.porHora ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Metrica
              rotulo="Profit"
              valor={num(resumo.profit)}
              nota={`${num(resumo.porHora.profit)}/h`}
            />
            <Metrica rotulo="Loot" valor={num(resumo.loot)} nota={`${num(resumo.porHora.loot)}/h`} />
            <Metrica
              rotulo="Supplies"
              valor={num(resumo.supplies)}
              nota={`${num(resumo.porHora.supplies)}/h · ${num(resumo.suppliesPorHunt ?? 0)}/hunt`}
            />
            <Metrica rotulo="XP" valor={num(resumo.xp)} nota={`${num(resumo.porHora.xp)}/h`} />
            <Metrica
              rotulo="XP Raw"
              valor={num(resumo.rawXp)}
              nota={`${num(resumo.porHora.rawXp)}/h`}
            />
            <Metrica
              rotulo="Tempo"
              valor={horas(resumo.segundos)}
              nota={`${resumo.hunts} hunt(s)`}
            />
          </div>
        ) : (
          <p className="text-sm opacity-70">Nenhuma hunt nesta semana ainda.</p>
        )}
        <p className="mt-2 text-xs opacity-60">
          Toda taxa é Σ total ÷ Σ horas, nunca a média das médias por sessão.
        </p>
      </section>

      {geral.spotsMaisCacados.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold">Hunts mais caçadas (geral)</h2>
          <table className="w-full text-sm">
            <thead className="text-left opacity-60">
              <tr>
                <th className="py-1">Spot</th>
                <th>Hunts</th>
                <th>Tempo</th>
                <th className="text-right">Profit</th>
              </tr>
            </thead>
            <tbody>
              {geral.spotsMaisCacados.map((s) => (
                <tr key={s.rotulo} className="border-t">
                  <td className="py-1">{s.rotulo}</td>
                  <td>{s.hunts}</td>
                  <td>{horas(s.segundos)}</td>
                  <td className="text-right tabular-nums">{num(s.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {geral.huntsSemRotulo > 0 && (
            <p className="mt-2 text-xs opacity-60">
              {geral.huntsSemRotulo} sessão(ões) sem nome de spot ficam de fora desta tabela.
            </p>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 font-semibold">Sessões ({linhas.length})</h2>
        {linhas.length === 0 ? (
          <p className="text-sm opacity-70">Nada importado ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left opacity-60">
              <tr>
                <th className="py-1">Início</th>
                <th>Dia do jogo</th>
                <th>Semana</th>
                <th>Spot</th>
                <th>Duração</th>
                <th className="text-right">Balance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const dia = diaTibia(new Date(l.inicio));
                return (
                  <tr key={l.id} className="border-t">
                    <td className="py-1">{new Date(l.inicio).toLocaleString("pt-BR")}</td>
                    <td>{dia}</td>
                    <td>{semanaTibia(dia)}</td>
                    <td>{l.spot?.nome ?? "—"}</td>
                    <td>{horas(l.duracao_s)}</td>
                    <td className="text-right tabular-nums">{num(l.loot - l.supplies)}</td>
                    <td className="text-right">
                      <form action={apagarSessao}>
                        <input type="hidden" name="id" value={l.id} />
                        <button className="text-xs underline opacity-60">apagar</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export default function PaginaHunts() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 p-6">
      <header>
        <h1 className="text-2xl font-bold">Analisador de Hunts</h1>
        <p className="text-sm opacity-70">lootibia — tela de teste do banco</p>
      </header>

      <Suspense fallback={<p className="text-sm opacity-60">Carregando suas sessões…</p>}>
        <Painel />
      </Suspense>

      <section>
        <h2 className="mb-3 font-semibold">Importar sessão</h2>
        <FormularioImportacao />
      </section>
    </main>
  );
}
