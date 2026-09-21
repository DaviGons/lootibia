-- ===========================================================================
-- APAGA TODAS AS CONTAS E TODOS OS DADOS. Rodado à mão, no SQL Editor.
-- ===========================================================================
--
-- NÃO é migration, e está fora de `migrations/` de propósito: migration roda
-- de novo quando alguém monta o banco do zero, e esta aqui não pode rodar duas
-- vezes por acidente.
--
-- Existe para a virada de e-mail+senha para usuário+senha (lib/conta.ts). As
-- contas antigas têm e-mail de verdade, não `@lootibia.invalid`, e nenhuma
-- delas passa por `usuarioDoEmail` — ficariam no banco sem conseguir entrar e
-- sem aparecer em `criar-usuario.ts --listar`.
--
-- O `delete` em `auth.users` basta: `sessao`, `perfil` e `codigo_vinculo`
-- referenciam `auth.users(id)` com `on delete cascade`, e `sessao_monstro` e
-- `sessao_item` caem junto com a sessão. As tabelas de lookup (`monstro`,
-- `item`, `spot`) sobrevivem, e é o certo — são vocabulário do jogo, não dado
-- de ninguém.

begin;

-- Confira antes de confirmar. Se este número te surpreender, dê `rollback`.
select count(*) as contas_que_serao_apagadas from auth.users;

delete from auth.users;

-- Tem de dar tudo zero.
select
  (select count(*) from auth.users)      as contas,
  (select count(*) from public.sessao)   as sessoes,
  (select count(*) from public.perfil)   as perfis;

commit;

-- Depois disto, crie a sua conta:
--   node --experimental-strip-types --env-file=.env.local scripts/criar-usuario.ts davi
--
-- ---------------------------------------------------------------------------
-- E no painel do Supabase (Authentication > Sign In / Providers), duas chaves:
--
--   1. "Allow new users to sign up" tem de ficar DESLIGADO.
--      Medido em 2026-09-19: `POST /auth/v1/signup` responde `422
--      signup_disabled`, ou seja, ja esta. Nao e tarefa — e o que conferir se um
--      dia aparecer conta que ninguem criou. Remover a tela de cadastro sozinha
--      seria decoracao: o endpoint do GoTrue atende quem souber o caminho.
--
--   2. "Confirm email" pode ficar como esta.
--      `criar-usuario.ts` cria com `email_confirm: true`, entao a conta ja nasce
--      confirmada e nenhuma mensagem e enviada para o dominio `.invalid` — que,
--      pela RFC 6761, nao existe. So importaria se houvesse outro caminho
--      criando conta, e com o cadastro desligado nao ha.
-- ---------------------------------------------------------------------------
