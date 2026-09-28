import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { hasEnvVars } from "@/lib/utils";
import { usuarioDoEmail } from "@/lib/conta";
import type { UnidadeDaMeta } from "@/lib/meta";
import { Lateral, type PastaNaLateral } from "@/components/lateral";

/**
 * A casca de toda página logada: lateral à esquerda, página à direita.
 *
 * `(app)` é grupo de rotas — não entra na URL. `/hunts`, `/config` e
 * `/calculadoras/...` continuam com o mesmo endereço; o que muda é que a
 * lateral é montada uma vez e sobrevive à navegação entre elas.
 */
export default function LayoutDoApp({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex">
      {/* Ler `cookies()` fora de <Suspense> é erro de build com Cache Components. */}
      <Suspense fallback={<div className="h-dvh w-[238px] shrink-0 border-r bg-secondary/40 max-lg:hidden" />}>
        <LateralDoUsuario />
      </Suspense>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

interface LinhaPasta {
  id: number;
  nome: string;
  meta_valor: number | null;
  meta_unidade: UnidadeDaMeta | null;
}

async function LateralDoUsuario() {
  if (!hasEnvVars) return null;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  // Sem sessão o proxy já mandou para o login; isto é só a rede de segurança.
  if (!auth.user) return null;

  // O mesmo recorte de sessões da tela de hunts (as 500 mais recentes), para
  // as contagens da lateral baterem com a lista. Só as colunas que contam.
  const [{ data: dadosSessoes }, { data: dadosPastas }, { data: dadosConfig }, { data: dadosChars }] =
    await Promise.all([
      supabase
        .from("sessao")
        .select("pasta_id, loot, supplies")
        .order("inicio", { ascending: false })
        .limit(500),
      supabase.from("pasta").select("id, nome, meta_valor, meta_unidade").order("ordem").order("id"),
      supabase.from("config_mundo").select("mundo, preco_tc"),
      supabase.from("usuario_personagem").select("mundo, personagem(id, nome)"),
    ]);

  const sessoes = (dadosSessoes ?? []) as { pasta_id: number | null; loot: number; supplies: number }[];
  const porPasta = new Map<number, { hunts: number; profit: number }>();
  let semPasta = 0;
  for (const s of sessoes) {
    if (s.pasta_id === null) {
      semPasta++;
      continue;
    }
    const a = porPasta.get(s.pasta_id) ?? { hunts: 0, profit: 0 };
    a.hunts += 1;
    a.profit += s.loot - s.supplies;
    porPasta.set(s.pasta_id, a);
  }

  const pastas: PastaNaLateral[] = ((dadosPastas ?? []) as LinhaPasta[]).map((p) => ({
    id: p.id,
    nome: p.nome,
    hunts: porPasta.get(p.id)?.hunts ?? 0,
    profit: porPasta.get(p.id)?.profit ?? 0,
    meta_valor: p.meta_valor,
    meta_unidade: p.meta_unidade,
  }));

  // O mundo vem do VÍNCULO, que só o dono escreve — é ele que escolhe o preço
  // da TC que converte as metas.
  const chars = (dadosChars ?? []) as unknown as {
    mundo: string | null;
    personagem: { id: number; nome: string } | null;
  }[];
  const mundo = chars.map((c) => c.mundo).find(Boolean) ?? null;
  const precoTc =
    ((dadosConfig ?? []) as { mundo: string; preco_tc: number }[]).find((c) => c.mundo === mundo)
      ?.preco_tc ?? null;

  // A janela de importação só oferece char cadastrado, e manda o id, não o nome.
  const charsDoSeletor = chars
    .map((c) => c.personagem)
    .filter((p): p is { id: number; nome: string } => p !== null)
    .map((p) => ({ id: p.id, nome: p.nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome));

  return (
    <Lateral
      pastas={pastas}
      totalDeHunts={sessoes.length}
      semPasta={semPasta}
      precoTc={precoTc}
      usuario={usuarioDoEmail(auth.user.email)}
      chars={charsDoSeletor}
    />
  );
}
