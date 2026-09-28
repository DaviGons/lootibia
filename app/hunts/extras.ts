"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buscarItem, ErroDaTibiaWiki } from "@/lib/tibiawiki";
import { tituloDeItem } from "@/lib/nomesDeItem";
import { idsPorNome } from "@/lib/importacao";
import { pastaEhMinha } from "@/lib/posse";
import type { UnidadeDaMeta } from "@/lib/meta";
import type { Resultado } from "./pastas";

/**
 * Drops extras: o usuário anotando quanto um rare vale de verdade.
 *
 * ## Por que o nome passa pelo TibiaWiki antes de virar linha
 *
 * `item` é lookup COMPARTILHADO (diretriz 49). Campo de texto livre gravando
 * direto ali já nos custou caro: era assim que o personagem funcionava, e cada
 * erro de digitação virava linha nova numa tabela que todo autenticado enxerga.
 *
 * Então o fluxo é o mesmo do `/config` com a TibiaData: **confere primeiro,
 * grava depois**. Nome que o wiki não conhece não entra no vocabulário, e quem
 * digitou recebe um recado dizendo isso — em vez de criar silenciosamente um
 * item que não existe.
 *
 * ## Isolamento
 *
 * Sem `.eq('usuario_id', …)`: quem isola é a RLS de `drop_extra`, que tem os
 * quatro verbos desde o `0004` (diretrizes 26 e 45).
 */

async function usuarioAtual() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, usuario: data.user };
}

/** Igual ao `maxLength` do formulário. Conferido aqui porque o cliente pode mandar qualquer coisa. */
const LIMITE_NOME_ITEM = 80;

/** Teto de `drop_extra.valor`, que é `integer`: 2,1 bilhões de gp ou de TC. */
const VALOR_MAXIMO = 2_147_483_647;

/** Aceita "30.000.000", "30000000" e "30 000 000". Recusa o resto. */
function lerValor(bruto: string): number | null {
  const limpo = bruto.replace(/[.\s]/g, "").replace(",", ".");
  const n = Number(limpo);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

export async function adicionarDropExtra(
  _anterior: Resultado | null,
  formData: FormData,
): Promise<Resultado> {
  const nome = String(formData.get("item") ?? "").trim();
  const unidade = String(formData.get("unidade") ?? "gp") as UnidadeDaMeta;
  const valor = lerValor(String(formData.get("valor") ?? ""));
  const pastaBruta = String(formData.get("pasta_id") ?? "");
  const pastaId = pastaBruta === "" ? null : Number(pastaBruta);

  if (!nome) return { ok: false, mensagem: "Diga qual item caiu." };
  if (nome.length > LIMITE_NOME_ITEM) {
    return { ok: false, mensagem: `O nome passa de ${LIMITE_NOME_ITEM} caracteres.` };
  }
  if (valor === null) return { ok: false, mensagem: "O valor precisa ser um número maior que zero." };
  if (valor > VALOR_MAXIMO) return { ok: false, mensagem: "Valor grande demais." };
  if (unidade !== "tc" && unidade !== "gp") return { ok: false, mensagem: "Unidade inválida." };
  if (pastaId !== null && !Number.isInteger(pastaId)) {
    return { ok: false, mensagem: "Pasta inválida." };
  }

  const { supabase, usuario } = await usuarioAtual();
  if (!usuario) return { ok: false, mensagem: "Faça login para anotar um drop." };
  if (pastaId !== null && !(await pastaEhMinha(supabase, pastaId))) {
    return { ok: false, mensagem: "Pasta inválida." };
  }

  // 1. O wiki conhece esse item? "Não existe" e "API fora do ar" são coisas
  //    diferentes, e o usuário precisa saber qual das duas aconteceu.
  let achado;
  try {
    achado = await buscarItem(nome);
  } catch (e) {
    if (e instanceof ErroDaTibiaWiki) {
      return { ok: false, mensagem: "O TibiaWiki não respondeu. Tente de novo em instantes." };
    }
    throw e;
  }
  if (!achado) {
    return {
      ok: false,
      mensagem: `O TibiaWiki não conhece "${tituloDeItem(nome)}". Confira o nome em inglês.`,
    };
  }

  // 2. O lookup guarda o nome como o parser do Hunt Analyser guardaria:
  //    minúsculo. Assim um rare anotado à mão e o mesmo item vindo de uma
  //    importação são A MESMA linha, e não duas.
  //    `idsPorNome` lê antes de inserir: item que já existe não gasta id da
  //    sequência (diretriz 56).
  const canonico = achado.titulo.toLowerCase();
  let itemId: number | undefined;
  try {
    itemId = (await idsPorNome(supabase, "item", [canonico])).get(canonico);
  } catch (e) {
    return { ok: false, mensagem: `Não deu para gravar o item: ${(e as Error).message}` };
  }
  if (itemId === undefined) return { ok: false, mensagem: "Não deu para encontrar o item gravado." };

  // 3. O extra em si. `usuario_id` vai no insert porque a coluna é `not null`;
  //    quem confere que é o seu é o `with check` da política.
  const { error } = await supabase.from("drop_extra").insert({
    usuario_id: usuario.id,
    pasta_id: pastaId,
    item_id: itemId,
    valor,
    unidade,
  });
  if (error) return { ok: false, mensagem: error.message };

  revalidatePath("/hunts");
  return { ok: true, mensagem: `${achado.titulo} anotado.` };
}

export async function apagarDropExtra(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;

  const { supabase, usuario } = await usuarioAtual();
  if (!usuario) return;

  await supabase.from("drop_extra").delete().eq("id", id);
  revalidatePath("/hunts");
}
