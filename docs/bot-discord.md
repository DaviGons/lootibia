# Bot do Discord — aposentado

> **STATUS: MORTO.** No ar de 2026-09-17 a 2026-09-22. Removido da `main` por decisão do Davi:
> na prática ninguém usava, e manter uma segunda casca sobre o mesmo domínio saía mais caro do que
> valia.

O código continua existindo, inteiro e funcional, na branch **`abandonado/bot-discord`**:

```bash
git log --oneline abandonado/bot-discord
git show abandonado/bot-discord:app/api/discord/route.ts
```

Essa branch não recebe mais commits. Quem quiser ressuscitar o bot parte dela — e vai precisar
reconciliar com o que a `main` mudou desde então.

## O que era

Quatro slash commands (`/cadastro`, `/addhunt`, `/viewstats`, `/meta`) num endpoint de HTTP
Interactions servido pelo próprio deploy da Vercel — sem processo ligado, sem host a mais. A
identidade passava por um JWT assinado pelo bot, de modo que a RLS continuava sendo quem isolava os
dados.

## O que sobreviveu na `main`

| O quê | Por quê |
|---|---|
| `lib/importacao.ts` | O núcleo da importação saiu de `acoes.ts` porque havia duas cascas. Restou uma, e a separação continua boa: mantém conversão de fuso e tratamento de duplicata fora de arquivo de UI. |
| `lib/supabase/jwt.ts` | Era `bot.ts`. `scripts/testar-pastas.ts` assina um token de usuário com ele para exercitar a RLS de verdade — a chave secreta a ignoraria, e é ela que o teste existe para verificar (diretriz 46). |
| `personagem`, `sessao.personagem_id` | Nasceram no `0002` junto com o bot; quem usa hoje é a tela. |
| `perfil.fuso` | A tabela existia para o bot herdar o fuso, já que ele não tem navegador. O fuso ficou: é o que diz a que dia de Tibia uma sessão pertence (docs/periodos.md). |

## O que foi derrubado no banco

`supabase/migrations/0004_aposenta_bot_discord.sql` — `codigo_vinculo`, `perfil.discord_id` e as
funções `vincular_discord`, `usuario_do_discord`, `limpar_codigos_expirados`.

As duas primeiras funções eram `security definer` com `grant execute to authenticated`: existiam
para atravessar a RLS de propósito, num recurso que deixou de existir. Código morto que ainda
responde é pior que código morto.

## Fora do repositório

- **App `Lootibia`** no Discord Developer Portal — os comandos foram desregistrados em 22/09;
  a Interactions Endpoint URL e o app em si são limpeza manual no portal.
- **Vercel** — `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID` e `SUPABASE_JWT_SECRET` deixaram de
  ser usados em produção. O `SUPABASE_JWT_SECRET` continua necessário **localmente**, em
  `.env.local`, para `scripts/testar-pastas.ts`.

## O que valeu a pena aprender

Três coisas que custaram tempo e não estão em lugar nenhum além daqui e do histórico:

1. **O proxy de auth engolia o endpoint.** O middleware redirecionava quem não tem sessão para
   `/auth/login`, e o Discord não manda cookie: toda interação levava `307` e o bot nunca respondia
   — com sintoma mudo do lado dele. Qualquer rota nova que precise ser pública tem de sair do
   `matcher` em `proxy.ts`.

2. **`create or replace view` não sobrevive a coluna nova no meio.** `sessao_periodo` é `select s.*`;
   ao acrescentar `personagem_id` a `sessao`, tudo que vinha depois andou uma casa e o Postgres leu
   como renomeação (`cannot change name of view column "balance"`). Exige `drop view` antes. Isso
   **continua valendo** e vai reaparecer na próxima coluna de `sessao` — o `0003` já teve de fazer o
   mesmo por causa de `pasta_id`.

3. **A referência de componentes do Discord envelheceu em cinco dias.** O desenho de 17/09 registrou
   que modal só aceita texto; em 21/09 já era falso. Nosso próprio doc envelhece igual, que é a razão
   deste arquivo existir em vez de ser apagado.
