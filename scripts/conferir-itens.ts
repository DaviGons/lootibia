/**
 * Mede o de-para de itens contra a TibiaWikiApi de verdade.
 *
 *   node --experimental-strip-types --env-file=.env.local scripts/conferir-itens.ts
 *
 * ## Por que existe
 *
 * `lib/nomesDeItem.ts` é lógica pura e tem teste próprio, mas o teste só prova
 * que a função faz o que eu escrevi. Ele não prova que a CONVENÇÃO do wiki é a
 * que eu supus — isso só a API responde (diretriz 14). Este script pega os
 * nomes que estão no banco de verdade e pergunta um por um.
 *
 * A saída é o número que importa: quantos dos nossos itens encontram página. O
 * que não encontrar sai listado, com as variantes tentadas, para virar exceção
 * explícita em vez de sumir.
 *
 * ## Educação com o servidor (diretriz 18)
 *
 * `tibiawiki.dev` tem pool de 2 threads e fila de 32. Duas requisições por vez,
 * com pausa entre os lotes. Isto é job de linha de comando, rodado à mão —
 * nunca no caminho de uma requisição de usuário.
 *
 * Não entra na diretriz 3: precisa de credencial do banco e de rede.
 */

import { createClient } from "@supabase/supabase-js";
import { variantesDeTitulo } from "../lib/nomesDeItem.ts";

const BASE = "https://tibiawiki.dev/api";
const UA = "lootibia/0.1 (+https://lootibia.vercel.app)";
const POR_LOTE = 2;
const PAUSA_MS = 350;

function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) {
    console.error(`Falta ${nome}. Rode com --env-file=.env.local.`);
    process.exit(1);
  }
  return v;
}

interface Achado {
  nome: string;
  titulo: string | null;
  npcvalue: string | null;
  tentadas: string[];
}

/** Tenta as variantes na ordem e para na primeira que responder. */
async function resolver(nome: string): Promise<Achado> {
  const tentadas = variantesDeTitulo(nome);
  for (const titulo of tentadas) {
    let r: Response;
    try {
      r = await fetch(`${BASE}/items/${encodeURIComponent(titulo)}`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      continue; // rede falhou nesta variante; tenta a próxima
    }
    if (r.status !== 200) continue;
    const texto = await r.text();
    try {
      const j = JSON.parse(texto) as { name?: string; npcvalue?: string; value?: string };
      if (j?.name) return { nome, titulo: j.name, npcvalue: j.npcvalue ?? j.value ?? null, tentadas };
    } catch {
      // 200 com corpo que não é JSON: trata como não encontrado (diretriz 16).
    }
  }
  return { nome, titulo: null, npcvalue: null, tentadas };
}

async function main() {
  const sb = createClient(
    exigir("NEXT_PUBLIC_SUPABASE_URL"),
    exigir("SUPABASE_SECRET_KEY"),
    { auth: { persistSession: false } },
  );
  const { data, error } = await sb.from("item").select("nome").order("nome");
  if (error) throw new Error(error.message);
  const nomes = (data ?? []).map((i) => i.nome as string);
  console.log(`${nomes.length} itens no banco. Consultando ${POR_LOTE} por vez…\n`);

  const achados: Achado[] = [];
  for (let i = 0; i < nomes.length; i += POR_LOTE) {
    achados.push(...(await Promise.all(nomes.slice(i, i + POR_LOTE).map(resolver))));
    if (i + POR_LOTE < nomes.length) await new Promise((r) => setTimeout(r, PAUSA_MS));
    process.stdout.write(`\r  ${Math.min(i + POR_LOTE, nomes.length)}/${nomes.length}`);
  }
  console.log("\n");

  const achou = achados.filter((a) => a.titulo !== null);
  const faltou = achados.filter((a) => a.titulo === null);
  // A segunda variante só existe quando a primeira tem preposição; se ela for a
  // que resolveu, a regra de minúsculas foi decisiva.
  const pelaSegunda = achou.filter((a) => a.tentadas.length > 1 && a.titulo !== a.tentadas[0]);

  console.log(`RESOLVIDOS : ${achou.length}/${nomes.length}`);
  console.log(`NAO ACHADOS: ${faltou.length}`);
  console.log(`com preposicao no nome (onde Title Case ingenuo quebraria): ${
    achados.filter((a) => a.tentadas.length > 1).length
  }`);
  if (pelaSegunda.length > 0) {
    console.log(`resolvidos pela SEGUNDA variante (regra de minusculas errou): ${pelaSegunda.length}`);
    for (const a of pelaSegunda) console.log(`  ${a.nome} -> ${a.titulo}`);
  }

  if (faltou.length > 0) {
    console.log("\nNAO ENCONTRADOS (viram excecao explicita, nao somem):");
    for (const a of faltou) console.log(`  ${JSON.stringify(a.nome)}  tentou: ${JSON.stringify(a.tentadas)}`);
  }

  const semValor = achou.filter((a) => a.npcvalue === null || a.npcvalue === "0");
  console.log(`\nsem npcvalue util (ausente ou "0"): ${semValor.length} de ${achou.length}`);
  console.log("  (npcvalue e referencia de NPC, nao preco de mercado — diretriz 24)");
}

main().catch((e) => {
  console.error("FALHOU:", (e as Error).message);
  process.exit(1);
});
