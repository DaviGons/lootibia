-- ============================================================================
-- lootibia — personagem, perfil e o fuso do usuário
-- Rodar no SQL Editor do Supabase, DEPOIS de 0001_schema.sql.
-- ============================================================================
--
-- Duas tabelas entram aqui:
--
--   * `personagem` — lookup igual a `spot` (diretriz 10: nome repetido vira id).
--   * `perfil`     — o fuso IANA herdado do navegador. Sem o fuso não dá para
--                    dizer a que dia de Tibia uma sessão pertence
--                    (docs/periodos.md), porque o Hunt Analyser não escreve
--                    fuso nenhum no texto que o jogador cola.
--
-- HISTÓRICO: este arquivo já criou também `codigo_vinculo` e as funções
-- `vincular_discord`, `usuario_do_discord` e `limpar_codigos_expirados`, que
-- serviam a uma integração externa aposentada em 2026-09-22 e derrubada do banco
-- no mesmo dia. Foram removidas daqui porque um banco montado do zero não deve
-- criar objeto para depois derrubá-lo — e porque `security definer` com
-- `grant execute to authenticated` existia para atravessar a RLS de propósito.
-- O estado final é idêntico ao do banco em produção, conferido coluna a coluna.

-- ---------------------------------------------------------------------------
-- Personagem
-- ---------------------------------------------------------------------------
-- Lookup compartilhado, mesma mecânica de `spot`. `smallint` comporta 32.767
-- nomes; um grupo de amigos não chega perto (diretriz 9).

create table if not exists public.personagem (
  id   smallint primary key generated always as identity,
  nome text     not null unique
);

comment on table public.personagem is
  'Nome do personagem, como o jogador escreve. O Hunt Analyser não informa: é rótulo do app.';

alter table public.sessao
  add column if not exists personagem_id smallint references public.personagem(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Perfil
-- ---------------------------------------------------------------------------
-- Uma linha por usuário, criada na primeira importação. Não cresce com o tempo,
-- então não precisa de retenção (diretriz 12).
--
-- `fuso` guarda o IANA do navegador ('America/Sao_Paulo'), não um offset:
-- offset fixo quebra duas vezes por ano e em silêncio (docs/periodos.md).

create table if not exists public.perfil (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  fuso       text not null default 'UTC'
);

comment on column public.perfil.fuso is
  'Fuso IANA do usuario, capturado no navegador. O Hunt Analyser nao escreve fuso nenhum, e sem ele nao da para dizer a que dia de Tibia uma sessao pertence.';

-- ---------------------------------------------------------------------------
-- Row Level Security (diretriz 26)
-- ---------------------------------------------------------------------------

alter table public.personagem enable row level security;
alter table public.perfil     enable row level security;

-- Personagem: mesmo regime dos outros lookups (0001). Vocabulário compartilhado:
-- todo autenticado lê e acrescenta, ninguém altera nem apaga.
drop policy if exists "personagem: autenticado le"     on public.personagem;
drop policy if exists "personagem: autenticado insere" on public.personagem;
create policy "personagem: autenticado le" on public.personagem for select
  to authenticated using (true);
create policy "personagem: autenticado insere" on public.personagem for insert
  to authenticated with check (true);

-- Perfil: cada um só enxerga e mexe no seu.
drop policy if exists "perfil: dono le"       on public.perfil;
drop policy if exists "perfil: dono insere"   on public.perfil;
drop policy if exists "perfil: dono atualiza" on public.perfil;
create policy "perfil: dono le" on public.perfil for select
  to authenticated using (auth.uid() = usuario_id);
create policy "perfil: dono insere" on public.perfil for insert
  to authenticated with check (auth.uid() = usuario_id);
create policy "perfil: dono atualiza" on public.perfil for update
  to authenticated using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);

-- ---------------------------------------------------------------------------
-- A view `sessao_periodo` precisa ser recriada, e com `drop` antes
-- ---------------------------------------------------------------------------
-- Ela é `select s.*`, então `personagem_id` entra nela sozinha. Mas
-- `create or replace view` só sabe acrescentar coluna no FIM: exige que as que
-- já existem mantenham nome, tipo e POSIÇÃO. Como `s.*` passou a expandir
-- `personagem_id` logo depois de `spot_id`, tudo que vinha depois andou uma
-- casa, e o Postgres leu isso como renomear:
--
--   ERROR: cannot change name of view column "balance" to "personagem_id"
--
-- `drop view` resolve porque view não guarda dado nenhum: é consulta salva.
-- Isto reaparece em TODA coluna nova de `sessao` — o 0003 teve de fazer o mesmo
-- por causa de `pasta_id`.
--
-- `security_invoker` vai INLINE, e não num `alter view` depois, de propósito:
-- entre um `create view` nu e o `alter` existe um instante em que a view roda
-- com os privilégios do dono e portanto ignora a RLS. A janela é curta e o
-- projeto é privado, mas fechá-la não custa nada.
drop view if exists public.sessao_periodo;

create view public.sessao_periodo
  with (security_invoker = on)
as
select
  s.*,
  (s.loot - s.supplies)                                            as balance,
  ((s.inicio at time zone 'Europe/Berlin') - interval '10 hours')::date
                                                                   as dia_tibia,
  to_char(((s.inicio at time zone 'Europe/Berlin') - interval '10 hours')::date,
          'IYYY-"W"IW')                                            as semana_tibia
from public.sessao s;

grant select on public.sessao_periodo to authenticated;

-- ---------------------------------------------------------------------------
-- Conferência (diretriz 13: medir, não estimar)
-- ---------------------------------------------------------------------------
-- select tablename, rowsecurity from pg_tables
--  where schemaname = 'public' and rowsecurity = false;   -- deve vir vazio
--
-- select pg_size_pretty(pg_database_size(current_database()));
