/**
 * Posse de ids que chegam do cliente — a parte que dá FRASE ao usuário.
 *
 * Fica fora dos arquivos `"use server"` de propósito: todo export de lá vira
 * ação que o navegador pode chamar, e isto é checagem interna, não endpoint.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A pasta com esse id é do usuário logado?
 *
 * **Isto não é a fronteira**, e já foi tratado como se fosse. O token do
 * usuário fala direto com o PostgREST e passa por fora de qualquer server
 * action, então uma conferência aqui só protege quem usa a tela. Quem recusa
 * de verdade, desde o 0005, é o `with check` das políticas de `sessao` e de
 * `drop_extra` (diretriz 57).
 *
 * Continua existindo pelo caso legítimo: a pasta apagada noutra aba enquanto
 * esta ainda mostrava o seletor. Sem esta consulta, o usuário leria um erro de
 * política do Postgres; com ela, lê "Pasta inválida".
 *
 * A RLS trabalha a favor aqui: `pasta` só deixa ler as próprias, e a alheia
 * volta vazia, igual a uma que não existe.
 */
export async function pastaEhMinha(supabase: SupabaseClient, pastaId: number): Promise<boolean> {
  const { data } = await supabase.from("pasta").select("id").eq("id", pastaId).maybeSingle();
  return data !== null;
}
