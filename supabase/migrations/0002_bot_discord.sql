-- ============================================================================
-- lootibia — delta de schema do bot do Discord
-- Rodar no SQL Editor do Supabase, DEPOIS de 0001_schema.sql.
-- Ver docs/bot-discord.md, seção "Delta de schema".
-- ============================================================================
--
-- Três coisas entram aqui, e as três precisam existir no SITE também, senão as
-- pontas divergem no primeiro dia:
--
--   * `personagem` — lookup igual a `spot` (diretriz 10: nome repetido vira id).
--   * `perfil`     — vínculo com o Discord e o fuso IANA herdado do navegador.
--                    Sem o fuso não dá para dizer a que dia de Tibia uma sessão
--                    pertence (docs/periodos.md), e o bot não tem navegador de
--                    onde tirá-lo: herda do que o site capturou.
--   * `codigo_vinculo` — código de uso único e vida curta, gerado no site e
--                    queimado pelo bot.
--
-- IDENTIDADE (docs/bot-discord.md, decisão 3): o bot assina um JWT com
-- `sub` = usuario_id, então `auth.uid()` continua valendo dentro das políticas
-- e a RLS segue sendo quem garante o isolamento — não o código do bot.

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
-- Uma linha por usuário, criada na primeira importação ou no primeiro
-- /cadastro. Não cresce com o tempo, então não precisa de retenção.
--
-- `fuso` guarda o IANA do navegador ('America/Sao_Paulo'), não um offset:
-- offset fixo quebra duas vezes por ano e em silêncio (docs/periodos.md).

create table if not exists public.perfil (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  discord_id text unique,
  fuso       text not null default 'UTC'
);

comment on column public.perfil.discord_id is
  'Snowflake do Discord. `text` porque é inteiro de 64 bits que o JS não representa com precisão.';
comment on column public.perfil.fuso is
  'Fuso IANA capturado no navegador. O bot herda daqui — não tem como perguntar.';

-- ---------------------------------------------------------------------------
-- Código de vínculo
-- ---------------------------------------------------------------------------
-- Gerado no site, digitado no modal do /cadastro, queimado na validação.
--
-- RETENÇÃO (diretriz 12), definida no mesmo commit que cria a tabela: código
-- expirado ou já usado é lixo puro e não pode acumular.
--
-- Quem executa a regra hoje é o próprio fluxo: `gerarCodigoDeVinculo` em
-- app/hunts/acoes.ts apaga TODOS os códigos do usuário antes de criar o novo.
-- Isso mantém a tabela em, no máximo, uma linha por usuário sem depender de
-- nada agendado — e este projeto ainda não tem cron.
--
-- `limpar_codigos_expirados()` abaixo é o expurgo em massa, para o dia em que
-- houver um cron diário (diretriz 27) ou uma conta abandonada sem novo código.

create table if not exists public.codigo_vinculo (
  codigo     text        primary key,
  usuario_id uuid        not null references auth.users(id) on delete cascade,
  expira_em  timestamptz not null,
  usado_em   timestamptz
);

-- Um código pendente por usuário de cada vez: gerar de novo substitui o
-- anterior, em vez de deixar vários válidos soltos por aí.
create unique index if not exists codigo_vinculo_um_pendente_idx
  on public.codigo_vinculo (usuario_id)
  where usado_em is null;

comment on table public.codigo_vinculo is
  'RETENCAO (diretriz 12): gerarCodigoDeVinculo apaga os codigos do usuario a cada geracao; limpar_codigos_expirados() e o expurgo em massa.';

create or replace function public.limpar_codigos_expirados()
returns integer
language sql
security definer
set search_path = public
as $func$
  with apagados as (
    delete from public.codigo_vinculo
     where expira_em < now() - interval '1 day'
    returning 1
  )
  select count(*)::integer from apagados;
$func$;

comment on function public.limpar_codigos_expirados is
  'Expurgo em massa da diretriz 12. Sem chamador hoje: o fluxo de gerarCodigoDeVinculo ja mantem a tabela limpa. Ligar ao cron diario (diretriz 27) quando ele existir.';

-- ---------------------------------------------------------------------------
-- Vínculo, em uma transação
-- ---------------------------------------------------------------------------
-- Validar e queimar o código precisa ser atômico: dois /cadastro simultâneos
-- com o mesmo código não podem vincular duas contas do Discord. O
-- `update ... where usado_em is null` resolve no banco, sem trava na aplicação.
--
-- `security definer` porque o bot chama isto ANTES de saber quem é o usuário —
-- é justamente o que a chamada descobre. Por isso ela é deliberadamente
-- estreita: recebe código e discord_id, devolve o usuario_id, e nada mais.

create or replace function public.vincular_discord(p_codigo text, p_discord_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_usuario uuid;
begin
  update public.codigo_vinculo
     set usado_em = now()
   where codigo = p_codigo
     and usado_em is null
     and expira_em > now()
  returning usuario_id into v_usuario;

  -- Inexistente, expirado ou já usado: o bot não distingue, de propósito.
  if v_usuario is null then
    return null;
  end if;

  insert into public.perfil (usuario_id, discord_id)
       values (v_usuario, p_discord_id)
  on conflict (usuario_id) do update set discord_id = excluded.discord_id;

  return v_usuario;
end;
$func$;

-- ---------------------------------------------------------------------------
-- Descobrir o usuário a partir do Discord
-- ---------------------------------------------------------------------------
-- Toda interação do bot começa aqui, e é o outro ponto em que ele ainda não tem
-- identidade: a RLS de `perfil` é `auth.uid() = usuario_id`, e o bot só tem o
-- snowflake do Discord. `security definer` pelo mesmo motivo de
-- `vincular_discord`, e igualmente estreita — devolve o id e o fuso, mais nada.
--
-- De posse do `usuario_id`, o bot assina um JWT com esse `sub` e daí em diante
-- toda consulta volta a passar pela RLS normalmente (lib/supabase/bot.ts).

create or replace function public.usuario_do_discord(p_discord_id text)
returns table (usuario_id uuid, fuso text)
language sql
security definer
set search_path = public
stable
as $func$
  select p.usuario_id, p.fuso
    from public.perfil p
   where p.discord_id = p_discord_id;
$func$;

revoke all on function public.vincular_discord(text, text) from public, anon;
grant execute on function public.vincular_discord(text, text) to authenticated;
revoke all on function public.usuario_do_discord(text) from public, anon;
grant execute on function public.usuario_do_discord(text) to authenticated;
revoke all on function public.limpar_codigos_expirados() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security (diretriz 26)
-- ---------------------------------------------------------------------------

alter table public.personagem     enable row level security;
alter table public.perfil         enable row level security;
alter table public.codigo_vinculo enable row level security;

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

-- Código de vínculo: o dono só enxerga o dele, e só pode criar para si. NÃO há
-- política de update — quem queima o código é `vincular_discord`, que roda como
-- `security definer` justamente para que ninguém marque código alheio como usado.
drop policy if exists "codigo_vinculo: dono le"     on public.codigo_vinculo;
drop policy if exists "codigo_vinculo: dono insere" on public.codigo_vinculo;
drop policy if exists "codigo_vinculo: dono apaga"  on public.codigo_vinculo;
create policy "codigo_vinculo: dono le" on public.codigo_vinculo for select
  to authenticated using (auth.uid() = usuario_id);
create policy "codigo_vinculo: dono insere" on public.codigo_vinculo for insert
  to authenticated with check (auth.uid() = usuario_id);
create policy "codigo_vinculo: dono apaga" on public.codigo_vinculo for delete
  to authenticated using (auth.uid() = usuario_id);

-- A view `sessao_periodo` é `select s.*`, então `personagem_id` entra nela
-- sozinha — mas ela PRECISA ser recriada, e com `drop` antes.
--
-- `create or replace view` só sabe acrescentar coluna no fim: ele exige que as
-- que já existem mantenham nome, tipo e POSIÇÃO. Como `s.*` passou a expandir
-- `personagem_id` logo depois de `spot_id`, tudo que vinha depois andou uma
-- casa, e o Postgres leu isso como renomear:
--
--   ERROR: cannot change name of view column "balance" to "personagem_id"
--
-- `drop view` resolve porque view não guarda dado nenhum: é consulta salva.
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
