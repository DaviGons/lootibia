-- ============================================================================
-- lootibia — endurecimento de segurança (2026-09-27)
-- Rodar no SQL Editor do Supabase, DEPOIS de 0004_drops_extras.sql.
--
-- COMPATÍVEL com o código que já está no ar: pode (e deve) ser aplicado ANTES
-- do deploy. O 0006 é o passo seguinte, e só DEPOIS do deploy.
-- ============================================================================
--
-- Cinco mudanças, cada uma medida contra o banco real antes de ser escrita:
--
--   1. Os ids das tabelas de lookup passam de `smallint` a `integer`.
--   2. Nome de lookup, `mundo` e `fuso` ganham teto de tamanho.
--   3. A posse da pasta e do personagem passa a ser conferida PELO BANCO.
--   4. O nome de um personagem não muda mais, e mundo, vocação e level passam
--      a ser de cada usuário, em `usuario_personagem`.
--   5. `anon` perde todo privilégio nas tabelas.

-- ---------------------------------------------------------------------------
-- A view e os gatilhos saem antes e voltam no fim
-- ---------------------------------------------------------------------------
-- `sessao_periodo` é `select s.*` e depende de `spot_id` e `personagem_id`, que
-- mudam de tipo abaixo — o Postgres recusa `alter column type` em coluna usada
-- por view. View não guarda dado: é consulta salva (ver 0002 e 0003).
--
-- Os gatilhos são criados por este mesmo arquivo, mais abaixo. Numa segunda
-- execução eles já existem, e `before update of personagem_id` prende a
-- coluna do mesmo jeito que a view: sem derrubar antes, reaplicar quebra com
-- "cannot alter type of a column used in a trigger definition". Medido.

drop view if exists public.sessao_periodo;
drop trigger if exists sessao_confere_personagem on public.sessao;
drop trigger if exists personagem_nome_imutavel on public.personagem;

-- ---------------------------------------------------------------------------
-- 1. Ids dos lookups: de smallint para integer (diretriz 56)
-- ---------------------------------------------------------------------------
-- `smallint` vinha da diretriz 9, e a conta parecia folgada: 32.767 nomes, o
-- wiki tem ~6,5 mil itens. O que ninguém contou é que o `upsert` com
-- `ignoreDuplicates` calcula o `nextval` da identity ANTES de descobrir o
-- conflito, e valor de sequência não volta. Medido em 2026-09-27:
--
--   item_id_seq = 1.179, com 156 itens gravados — ~30 ids por importação.
--
-- Isso dava umas 1.000 importações até o teto, somando todas as contas, e
-- depois qualquer sessão com item falharia para todo mundo. Pior: uma chamada
-- só ao PostgREST, com 31 mil nomes repetidos, esgotava tudo sem gravar linha.
--
-- O código parou de queimar ids (`idsPorNome` lê antes de inserir). Isto aqui
-- tira o teto de alcance. E o custo em bytes é ZERO: o `smallint` vinha
-- seguido de `integer`, e o alinhamento de 4 bytes já comia os 2 que ele
-- economizava. Medido com `pg_column_size` num banco de teste, antes e depois:
-- `sessao_item` 36 → 36, `sessao_monstro` 36 → 36, `drop_extra` 72 → 72,
-- `sessao` 104 → 104.
--
-- Primeiro quem referencia, depois quem é referenciado: FK entre `integer` e
-- `smallint` é aceita no meio do caminho, porque os dois têm operador de
-- igualdade na mesma família de índice.

alter table public.sessao_item        alter column item_id       type integer;
alter table public.drop_extra         alter column item_id       type integer;
alter table public.sessao_monstro     alter column monstro_id    type integer;
alter table public.sessao             alter column spot_id       type integer;
alter table public.sessao             alter column personagem_id type integer;
alter table public.usuario_personagem alter column personagem_id type integer;

alter table public.item       alter column id type integer;
alter table public.monstro    alter column id type integer;
alter table public.spot       alter column id type integer;
alter table public.personagem alter column id type integer;

-- A sequência da identity acompanha o tipo da coluna, mas explícito não custa:
-- `as integer` leva o `maxvalue` de 32.767 para 2.147.483.647, porque ele
-- estava no máximo do tipo antigo.
alter sequence public.item_id_seq       as integer;
alter sequence public.monstro_id_seq    as integer;
alter sequence public.spot_id_seq       as integer;
alter sequence public.personagem_id_seq as integer;

comment on table public.monstro is
  'Vocabulario compartilhado. Id integer desde 0005: smallint esgotava porque o upsert queima nextval (diretriz 56).';
comment on table public.item is
  'Vocabulario compartilhado. Id integer desde 0005: smallint esgotava porque o upsert queima nextval (diretriz 56).';

-- ---------------------------------------------------------------------------
-- 2. Teto de tamanho nos textos que o cliente escreve
-- ---------------------------------------------------------------------------
-- Todo autenticado insere nos lookups (risco aceito desde o 0001), e sem teto
-- um nome de 1 MB é uma linha válida. Os tetos ficam muito acima do que existe:
-- em 2026-09-27 o maior item tinha 27 caracteres, o maior monstro 22, o maior
-- spot 15, o maior personagem 17, o maior mundo 7 e o maior fuso 17.
--
-- Os mesmos números estão no código (`MAX_NOME`, `LIMITE_SPOT`), para o
-- usuário receber frase em vez de erro de constraint.

alter table public.item         drop constraint if exists item_nome_tamanho;
alter table public.monstro      drop constraint if exists monstro_nome_tamanho;
alter table public.spot         drop constraint if exists spot_nome_tamanho;
alter table public.personagem   drop constraint if exists personagem_nome_tamanho;
alter table public.config_mundo drop constraint if exists config_mundo_mundo_tamanho;
alter table public.perfil       drop constraint if exists perfil_fuso_tamanho;

alter table public.item       add constraint item_nome_tamanho       check (length(nome) between 1 and 100);
alter table public.monstro    add constraint monstro_nome_tamanho    check (length(nome) between 1 and 100);
alter table public.spot       add constraint spot_nome_tamanho       check (length(nome) between 1 and 60);
alter table public.personagem add constraint personagem_nome_tamanho check (length(nome) between 1 and 60);
alter table public.config_mundo add constraint config_mundo_mundo_tamanho
  check (length(mundo) between 1 and 40);
alter table public.perfil add constraint perfil_fuso_tamanho check (length(fuso) between 1 and 64);

-- ---------------------------------------------------------------------------
-- 3. Posse conferida pelo BANCO, não pela server action (diretriz 57)
-- ---------------------------------------------------------------------------
-- O token do usuário mora num cookie que o JavaScript lê, e a chave publicável
-- é pública. Qualquer um logado fala direto com o PostgREST e pula as server
-- actions — e com elas as checagens de posse que viviam lá. A RLS de `sessao`
-- e de `drop_extra` só conferia o `usuario_id` da PRÓPRIA linha; a FK de
-- `pasta_id` é conferida por fora da RLS e aceita o id da pasta de outra
-- pessoa sem reclamar.
--
-- Pasta: `with check`, porque a posse de uma pasta não muda — ela é sempre de
-- quem a criou, e apagar põe `null` na sessão. `using` continua o mesmo.

drop policy if exists "sessao: dono insere"   on public.sessao;
drop policy if exists "sessao: dono atualiza" on public.sessao;

create policy "sessao: dono insere" on public.sessao for insert
  to authenticated with check (
    auth.uid() = usuario_id
    and (sessao.pasta_id is null or exists (
      select 1 from public.pasta p
       where p.id = sessao.pasta_id and p.usuario_id = auth.uid()))
  );
create policy "sessao: dono atualiza" on public.sessao for update
  to authenticated
  using (auth.uid() = usuario_id)
  with check (
    auth.uid() = usuario_id
    and (sessao.pasta_id is null or exists (
      select 1 from public.pasta p
       where p.id = sessao.pasta_id and p.usuario_id = auth.uid()))
  );

drop policy if exists "drop_extra: dono insere"   on public.drop_extra;
drop policy if exists "drop_extra: dono atualiza" on public.drop_extra;

create policy "drop_extra: dono insere" on public.drop_extra for insert
  to authenticated with check (
    auth.uid() = usuario_id
    and (drop_extra.pasta_id is null or exists (
      select 1 from public.pasta p
       where p.id = drop_extra.pasta_id and p.usuario_id = auth.uid()))
  );
create policy "drop_extra: dono atualiza" on public.drop_extra for update
  to authenticated
  using (auth.uid() = usuario_id)
  with check (
    auth.uid() = usuario_id
    and (drop_extra.pasta_id is null or exists (
      select 1 from public.pasta p
       where p.id = drop_extra.pasta_id and p.usuario_id = auth.uid()))
  );

-- Personagem: GATILHO, e não `with check`, por um motivo que a RLS não vê.
--
-- O vínculo com o personagem pode acabar depois — `removerPersonagem` desfaz
-- o vínculo e as hunts continuam apontando para o char. Com a regra no
-- `with check` do update, mover uma dessas hunts para uma pasta passaria a
-- ser recusado, porque o `with check` só enxerga a linha NOVA e não sabe que o
-- personagem nem mudou. E recusado em silêncio, que é a diretriz 45 de novo.
-- O gatilho enxerga `old`, e só confere quando o personagem muda de fato.
--
-- `auth.uid()` nulo é o dono do banco (SQL Editor, chave secreta), para quem a
-- RLS já não vale: o gatilho segue a mesma regra.

create or replace function public.conferir_personagem_da_sessao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or new.personagem_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.personagem_id is not distinct from old.personagem_id then
    return new;
  end if;
  if not exists (
    select 1 from public.usuario_personagem up
     where up.personagem_id = new.personagem_id
       and up.usuario_id = auth.uid()
  ) then
    raise exception 'personagem % nao esta vinculado a esta conta', new.personagem_id
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Função de gatilho não é chamada por ninguém: dispara sozinha. Sem `execute`
-- para os papéis da API, ela nem aparece como RPC.
revoke all on function public.conferir_personagem_da_sessao() from public, anon, authenticated;

drop trigger if exists sessao_confere_personagem on public.sessao;
create trigger sessao_confere_personagem
  before insert or update of personagem_id on public.sessao
  for each row execute function public.conferir_personagem_da_sessao();

-- ---------------------------------------------------------------------------
-- 4. Personagem: o nome é de todos, o resto é de cada um
-- ---------------------------------------------------------------------------
-- A política "personagem: autenticado atualiza" do 0003 é `using (true) with
-- check (true)`: qualquer conta renomeia o char de outra, ou troca o mundo
-- dele — e o mundo decide o preço da TC na tela da vítima. O 0003 contava que
-- "a próxima consulta sobrescreve", o que vale para o level mas não para o
-- nome: renomeado, o char da vítima some da busca por nome e não volta.
--
-- a) O nome não muda mais. Gatilho, para valer mesmo que alguém recrie uma
--    política de update um dia. O `upsert` do código que está no ar grava
--    `nome = excluded.nome`, que é o mesmo nome, e passa.

create or replace function public.personagem_nome_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and new.nome is distinct from old.nome then
    raise exception 'o nome de um personagem nao muda' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.personagem_nome_imutavel() from public, anon, authenticated;

drop trigger if exists personagem_nome_imutavel on public.personagem;
create trigger personagem_nome_imutavel
  before update of nome on public.personagem
  for each row execute function public.personagem_nome_imutavel();

-- b) Mundo, vocação e level passam para o vínculo. Cada usuário guarda o que a
--    TibiaData respondeu quando ELE consultou, e só ele escreve ali. A linha
--    do vínculo vai de 42 para 72 bytes (medido no banco de teste), e ninguém
--    tem mais que uma dúzia; um char em duas contas vira duas linhas.
--
--    As colunas de `personagem` ficam até o 0006: o código que está no ar
--    ainda lê de lá, e este arquivo tem de ser seguro de aplicar antes do
--    deploy.

alter table public.usuario_personagem
  add column if not exists mundo    text check (length(mundo) between 1 and 40),
  add column if not exists vocacao  text check (length(vocacao) between 1 and 40),
  add column if not exists nivel    integer check (nivel > 0),
  add column if not exists visto_em timestamptz;

comment on column public.usuario_personagem.visto_em is
  'Quando a TibiaData respondeu para ESTE usuario. Nulo = vinculo sem consulta.';

-- `nullif`: o código antigo gravava '' quando a TibiaData não mandava o campo,
-- e string vazia não passa no teto de tamanho.
--
-- Dentro de um `if` e por `execute` porque o 0006 apaga as colunas de origem:
-- reaplicar este arquivo depois dele não pode quebrar aqui.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'personagem' and column_name = 'mundo'
  ) then
    execute $sql$
      update public.usuario_personagem up
         set mundo    = nullif(p.mundo, ''),
             vocacao  = nullif(p.vocacao, ''),
             nivel    = p.nivel,
             visto_em = p.visto_em
        from public.personagem p
       where p.id = up.personagem_id
         and up.visto_em is null
    $sql$;
  end if;
end $$;

-- O vínculo ganha UPDATE — o `upsert` do cadastro grava os fatos novos na
-- linha que já existe. `using` E `with check`, como manda a diretriz 45.
drop policy if exists "usuario_personagem: dono atualiza" on public.usuario_personagem;
create policy "usuario_personagem: dono atualiza" on public.usuario_personagem for update
  to authenticated using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);

-- ---------------------------------------------------------------------------
-- A view volta, igual à do 0003
-- ---------------------------------------------------------------------------

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
-- 5. anon não tem nada a fazer nas tabelas
-- ---------------------------------------------------------------------------
-- O Supabase dá TODOS os privilégios de tabela a `anon` e a `authenticated`
-- por padrão — `truncate` incluso —, e a RLS é a única coisa que segura.
-- Nenhuma política deste projeto é `to anon`, e o site nunca lê dado sem
-- login. Tirar o privilégio de `anon` é defesa em profundidade: se um dia
-- alguém desligar a RLS de uma tabela sem querer, ela não vira pública.
--
-- `truncate`, `references` e `trigger` saem de `authenticated` também: a RLS
-- não vale para `truncate`, e nenhum dos três é usado pelo app.
--
-- E o padrão muda para o que vier depois: tabela nova nasce sem nada para
-- `anon`, e função nova nasce sem `execute` para ninguém — quem precisar dá o
-- `grant` explícito.

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon;

-- ---------------------------------------------------------------------------
-- Conferência (diretriz 13: medir, não estimar)
-- ---------------------------------------------------------------------------
-- As sequências dos lookups têm de dizer `integer` e 2147483647:
--   select sequencename, data_type, last_value, max_value from pg_sequences
--    where schemaname = 'public' order by 1;
--
-- `anon` não pode ter privilégio nenhum — tem de vir vazio:
--   select table_name, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and grantee = 'anon';
--
-- As políticas novas, com a pasta no `with check`:
--   select tablename, cmd, policyname, with_check from pg_policies
--    where schemaname = 'public' and tablename in ('sessao','drop_extra','usuario_personagem')
--    order by 1, 2;
--
-- E o teste de ponta a ponta, que exercita tudo isto com usuários de verdade:
--   node --experimental-strip-types --env-file=.env.local scripts/testar-pastas.ts
