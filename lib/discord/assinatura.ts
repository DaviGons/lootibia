/**
 * Ver docs/bot-discord.md.
 *
 * Verificação da assinatura Ed25519 que o Discord põe em toda interação.
 *
 * Isto NÃO é opcional e não é detalhe de segurança "para depois": o endpoint de
 * interações é público, e o Discord recusa registrar uma URL que não devolva
 * `401` para assinatura inválida. Sem esta checagem qualquer um manda um POST
 * dizendo ser qualquer usuário do Discord.
 *
 * Sem dependência externa. Node traz Ed25519 nativo em `crypto.verify`, o que
 * dispensa `discord-interactions` e `tweetnacl` — duas dependências a menos num
 * caminho de requisição que precisa caber na janela de 3 s (a de cold start
 * inclusive). O único incômodo é que o Discord publica a chave como 32 bytes
 * crus em hex e `createPublicKey` só aceita DER/PEM; o prefixo SPKI de Ed25519 é
 * constante, então basta concatenar.
 */

import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { Buffer } from "node:buffer";

/**
 * Cabeçalho DER de uma SubjectPublicKeyInfo de Ed25519. Constante: identifica o
 * algoritmo (OID 1.3.101.112) e o tamanho, sempre 32 bytes de chave.
 */
const PREFIXO_SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

const TAMANHO_CHAVE = 32;
const TAMANHO_ASSINATURA = 64;

/** Converte hex em Buffer, recusando o que não for hex do tamanho esperado. */
function hex(bruto: string, bytesEsperados: number): Buffer | null {
  if (bruto.length !== bytesEsperados * 2 || !/^[0-9a-fA-F]+$/.test(bruto)) return null;
  const buf = Buffer.from(bruto, "hex");
  return buf.length === bytesEsperados ? buf : null;
}

/**
 * Monta a chave pública a partir dos 32 bytes em hex que o Discord mostra no
 * portal do app.
 *
 * Lança se a chave for inválida — é erro de configuração, não de requisição, e
 * falhar alto no boot é melhor que recusar toda interação em silêncio.
 */
export function chavePublicaDoDiscord(chaveHex: string): KeyObject {
  const bruta = hex(chaveHex.trim(), TAMANHO_CHAVE);
  if (!bruta) {
    throw new Error(
      `DISCORD_PUBLIC_KEY inválida: esperados ${TAMANHO_CHAVE} bytes em hex, veio ${chaveHex.length} caracteres.`,
    );
  }
  return createPublicKey({
    key: Buffer.concat([PREFIXO_SPKI_ED25519, bruta]),
    format: "der",
    type: "spki",
  });
}

/**
 * Confere a assinatura de uma interação.
 *
 * O Discord assina a concatenação `timestamp + corpo cru`. "Cru" é literal: o
 * corpo tem de ser o texto exato que chegou, antes de qualquer `JSON.parse`
 * seguido de `JSON.stringify` — reserializar reordena chaves e invalida a
 * assinatura.
 *
 * Devolve booleano em vez de lançar: assinatura inválida é entrada hostil
 * esperada, não excepcional.
 */
export function assinaturaConfere(
  chave: KeyObject,
  assinaturaHex: string | null,
  timestamp: string | null,
  corpoCru: string,
): boolean {
  if (!assinaturaHex || !timestamp) return false;

  const assinatura = hex(assinaturaHex, TAMANHO_ASSINATURA);
  if (!assinatura) return false;

  try {
    return verify(null, Buffer.from(timestamp + corpoCru, "utf8"), chave, assinatura);
  } catch {
    // `verify` lança em chave ou assinatura malformada. Do ponto de vista do
    // endpoint isso é o mesmo que não conferir.
    return false;
  }
}
