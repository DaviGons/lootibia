# Bot do Discord — desenho e implementação

> **STATUS: IMPLEMENTADO, NÃO TESTADO CONTRA O DISCORD REAL.** Desenhado e implementado em
> 2026-09-17. Limites do Discord citados aqui foram conferidos na documentação oficial na mesma
> data; o que **não** deu para confirmar está marcado como tal na seção "A verificar".
>
> O que falta para rodar está em [Como colocar no ar](#como-colocar-no-ar), no fim.

Leia junto com [AGENTS.md](../AGENTS.md) — as diretrizes continuam valendo, e as 34 a 36 nasceram
deste trabalho.

## Onde está cada coisa

| Arquivo | Papel |
|---|---|
| `app/api/discord/route.ts` | O bot inteiro: verifica assinatura, roteia comandos e modais |
| `lib/discord/assinatura.ts` | Ed25519 nativo do Node, sem dependência |
| `lib/discord/protocolo.ts` | Tipos, limites e construtores de resposta do Discord |
| `lib/discord/comandos.ts` | Definição dos comandos e dos campos de modal |
| `lib/discord/janela.ts` | Rótulo de período → intervalo `[início, fim)` em UTC |
| `lib/discord/embed.ts` | `ResumoDeHunts` → embed que cabe nos limites |
| `lib/supabase/bot.ts` | **Único** ponto de contato com o Supabase; assina o JWT |
| `lib/importacao.ts` | Núcleo da importação, compartilhado com a tela |
| `lib/consulta.ts` | Leitura agregada de um período |
| `scripts/registrar-comandos.ts` | Registra os slash commands (rodado à mão) |
| `supabase/migrations/0002_bot_discord.sql` | `personagem`, `perfil`, `codigo_vinculo` |
| `lib/discord.test.ts` | 103 asserções, sem framework, sem rede |

Três decisões de implementação que o desenho não previa:

1. **Node traz Ed25519 nativo** (`crypto.verify(null, …)`), o que dispensou `discord-interactions`
   e `tweetnacl`. O único incômodo é que o Discord publica a chave como 32 bytes crus em hex e
   `createPublicKey` só aceita DER — o prefixo SPKI de Ed25519 é constante, então basta concatenar.
2. **`after()` do Next é obrigatório**, não otimização. Ver diretriz 35.
3. **`export const runtime = 'nodejs'` não compila** com Cache Components ligado. Node já é o padrão
   de route handler, então o efeito é o desejado — mas o aviso em tempo de build se perde.

## Para quem é

Círculo fechado: o Davi e alguns amigos. **Não é produto público.** Isso afrouxa a decisão de
identidade (ver abaixo) e mantém o orçamento de 500 MB confortável, mas não é desculpa para deixar
a RLS de lado no site.

## O que já está pronto

O domínio inteiro é **lógica pura, sem uma linha de Next**, e migra sem tocar:

| Módulo | O que faz |
|---|---|
| `lib/huntSession.ts` | Parseia o texto do Hunt Analyser |
| `lib/huntAgregado.ts` | `resumirHunts`, `resumirPorPeriodo` |
| `lib/periodo.ts` | Dia e semana do jogo (server save às 10:00 de Berlim) |
| `lib/nomesDeCriatura.ts` · `lib/sprites.ts` | De-para de nome e sprite |

Os testes desses módulos rodam com `node --experimental-strip-types`, sem framework — é a prova de
que não há acoplamento com o Next.

**Não migra:** `app/hunts/*` (tela e server actions). O bot é outra casca sobre o mesmo domínio.

---

## Decisão 1: HTTP Interactions, não Gateway

| | Gateway (discord.js) | **HTTP Interactions** |
|---|---|---|
| Mecânica | WebSocket permanente | Discord faz `POST` numa URL |
| Roda na Vercel? | **Não** — serverless não segura conexão | **Sim**, é um route handler |
| Infra extra | Railway / Fly / VPS sempre ligado | nenhuma |
| Lê mensagem solta no canal | sim (intent privilegiada) | não, só slash command |

**Escolhido: HTTP Interactions.** Cabe no deploy que já existe, não acrescenta host nem custo, e o
projeto é Vercel Hobby (diretriz 25). O preço é que tudo vira slash command — não existe "cola o
analyzer no canal e o bot pega sozinho".

### A janela de 3 segundos

Confirmado na documentação: a resposta inicial tem de sair em **3 segundos**, senão o token é
invalidado. Um `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` estende para **15 minutos**.

Parse + gravação no Supabase levam ~1 s, mas **sempre adiar** — cold start de função serverless
come esse orçamento sozinho.

**Exceção importante:** responder com **modal precisa ser a resposta inicial**. Não dá para adiar e
depois abrir modal. Então o fluxo é sempre:

```
/comando  →  responde MODAL (imediato, sem defer)
             ↓ usuário preenche e envia
             nova interação  →  defer  →  trabalha  →  edita a resposta
```

---

## Decisão 2: todo comando abre modal

Não é preferência estética. São dois problemas concretos:

**O analyzer é multilinha.** A barra de comando do Discord é campo de linha única. Um argumento de
texto aceita até 6.000 caracteres (confirmado na doc), mas colar 25 linhas ali é inviável na
prática. Campo de **parágrafo em modal aceita 4.000 caracteres** (confirmado) — e a maior sessão
real que medimos, com 37 itens de loot, tem **~1.460 caracteres**. Folga de quase 3×.

**Argumento de slash command aparece no canal.** O código de vínculo do `/cadastro` vazaria para
quem estivesse olhando. O que se digita em modal ninguém mais vê.

---

## Os comandos

### `/addhunt` — importar sessão

```
/addhunt  →  modal
  ├── Personagem      (linha única)
  ├── Local da hunt   (linha única)
  └── Hunt Analyser   (parágrafo, max_length 4000)
```

Faz o mesmo que `importarSessao` em `app/hunts/acoes.ts`: parseia, resolve os lookups, grava a
sessão e as linhas de detalhe. Responde com embed de confirmação.

- **Duplicata** já é tratada pelo schema: `unique (usuario_id, inicio)` devolve `23505`, que vira
  "esta sessão já foi importada".
- **Personagem não existe no schema hoje** — ver "Delta de schema".
- Opcional: validar o nome contra `/v4/character/{name}` da TibiaData, que confirma a existência e
  ainda traz mundo, vocação e level. Custa uma chamada dentro da janela adiada.

### `/viewstats` — os números da tela, em embed

```
/viewstats [periodo: semana | semana passada | mes | tudo] [personagem]
```

Sem filtro o comando só sabe responder "semana atual", e isso vai faltar na primeira semana de uso.

Conteúdo: o mesmo de `/hunts` — profit, loot, supplies, XP e XP Raw, tempo, mobs mortos, hunts mais
caçadas. **As regras de cálculo são as mesmas e não se negociam**: toda taxa é `Σ total / Σ horas`,
nunca média das médias (ver escopo em AGENTS.md).

Limites de embed a respeitar: **1.024 caracteres por campo, 6.000 no embed inteiro**. A lista de
mobs precisa de corte — top 10 e "+N outros".

**Decidido em 2026-09-17: efêmera por padrão, pública por escolha de quem chama** — o argumento
`publico: true`. Num grupo de amigos a graça é comparar, mas quem não quer mostrar o número ruim da
semana não deveria ser obrigado.

Detalhe de implementação que essa decisão impõe: **a visibilidade é decidida no defer e não muda
depois**. O follow-up não consegue alterar a flag de uma resposta já adiada, então o handler lê o
argumento antes de responder, não dentro do `after()`.

O filtro implementado é `semana` (padrão) · `semana-passada` · `mes` · `tudo`. As fronteiras são as
do jogo, não as do calendário civil: a semana abre no server save de segunda, e o mês no server save
do dia 1 — uma hunt às 09:00 de Berlim do dia 1 pertence ao último dia do mês anterior.

### `/ranking` — o que justifica o bot existir

**Fora da primeira entrega** (decidido em 2026-09-17). Comparar profit/h entre os membros do grupo é
a única coisa aqui que um bot faz melhor que uma página web, então continua sendo o próximo
candidato.

Atenção quando for implementado: cruza dados entre usuários, então **não pode** rodar com a RLS
escopada num único usuário — o que é exatamente o que `lib/supabase/bot.ts` faz hoje. Precisa de uma
consulta agregada deliberada (uma função `security definer` que devolva só o agregado, no espírito
de `usuario_do_discord`), e de todo mundo ciente de que os números aparecem para o grupo.

### `/cadastro` — vincular Discord ao site

```
/cadastro  →  modal
  └── Código   (linha única, gerado no site)
```

O site ganha uma tela que gera um código **de uso único e vida curta** (~10 min). O bot valida,
grava `discord_id → usuario_id` e queima o código.

**Isto resolve o fuso horário de graça.** O site já captura o fuso IANA do navegador na importação
(`America/Sao_Paulo`). Guardando no perfil, o bot herda e nunca precisa perguntar — e sem fuso não
dá para dizer a que dia de Tibia a sessão pertence, porque 19:34 em São Paulo é 00:34 em Berlim, ou
seja, ainda o dia anterior. Ver [periodos.md](periodos.md).

### `/hunts` — listar e apagar (sugerido, não pedido)

O site deixa apagar sessão; o bot não teria como. Quem colar o analyzer errado fica preso até abrir
o site. Um comando que lista as últimas com botão de apagar fecha o buraco.

---

## Decisão 3: identidade e RLS

O schema amarra `sessao.usuario_id` em `auth.users(id)` e a RLS usa `auth.uid()`. O Discord entrega
um ID de usuário do Discord, não uma sessão do Supabase. Três saídas:

| | Como | Risco |
|---|---|---|
| 1 | Bot usa a chave `service_role` | Ignora a RLS; qualquer bug no bot vira vazamento total |
| 2 | Vínculo de contas (`/cadastro`) | Resolve *quem é quem*, não *quem pode o quê* |
| 3 | Bot assina um JWT com `sub` = `usuario_id` | A RLS continua mandando |

**O vínculo (2) é obrigatório nos três casos** e já está no plano. A escolha real é entre 1 e 3
depois dele.

**Escolhida: 3** (decidido em 2026-09-17). Depois que o vínculo existe, assinar o JWT com o segredo
do projeto mantém a RLS como quem garante o isolamento, em vez do código do bot. Como é círculo
fechado, a opção 1 é defensável — mas é uma escolha, não um padrão. Virou a diretriz 34.

A chave secreta, em qualquer caso, **nunca** em variável `NEXT_PUBLIC_*` (diretriz 26).

### O que a implementação descobriu

**O projeto Supabase usa chaves JWT assimétricas (ES256/P-256).** Conferido no JWKS público do
projeto, que traz uma única chave `ES256`. A privada fica com o Supabase e **não é exportável** —
não dá para assinar com ela.

Logo, `lib/supabase/bot.ts` assina em **HS256 com o segredo legado** do projeto. O painel mostra
`Legacy JWT secret (still used) — Used only to verify JWTs`: o Supabase parou de *emitir* em HS256,
mas continua **verificando**, que é exatamente o lado de que precisamos — nós assinamos, ele
verifica.

**Confirmado na prática em 2026-09-17**, não por leitura da tela. `scripts/checar-jwt.ts` assina um
token igual ao do bot e bate em `/rest/v1/sessao`:

```
segredo do projeto          HTTP 200  []
segredo errado (controle)   HTTP 401  "None of the keys was able to decode the JWT"
```

O `200 []` é token aceito com a RLS filtrando tudo (o `sub` é um uuid inexistente). O controle com
segredo errado é o que dá sentido ao teste: sem ele, um `200` poderia ser o PostgREST ignorando o
`Authorization` e caindo na chave publicável.

Rodar de novo quando algo der `401` sem explicação:

```bash
node --experimental-strip-types --env-file=.env.local scripts/checar-jwt.ts
```

Se esse segredo for revogado, o bot para de autenticar. As saídas, nessa ordem:

1. Reabilitar o segredo legado no painel — é uma chave, não uma mudança de arquitetura.
2. Cair para `service_role` (opção 1), aceitando que o isolamento vira responsabilidade do código.
3. Trocar o mecanismo por um login real de serviço no Supabase.

Em qualquer dos três, **o arquivo a reescrever é só `lib/supabase/bot.ts`**: todo o resto do bot
chama `clienteDoUsuario` e não sabe como o token nasceu. Foi para isso que ele existe.

### Claims que o token precisa carregar

Errar aqui produz uma falha confusa: o PostgREST aceita o token e nega tudo.

| Claim | Valor | Por quê |
|---|---|---|
| `sub` | `usuario_id` | É o que `auth.uid()` devolve dentro das políticas |
| `role` | `authenticated` | Sem isto o token cai em `anon`, que não tem política nenhuma |
| `aud` | `authenticated` | Validado pelo GoTrue |
| `exp` | `iat + 120 s` | O token morre com a requisição; não há nada para renovar |

Dois pontos do schema ficam **fora** desse regime, porque acontecem antes de o bot saber quem é o
usuário — é justamente o que a chamada descobre: `vincular_discord` e `usuario_do_discord`. As duas
são `security definer` e deliberadamente estreitas.

---

## Delta de schema

> **Implementado em `supabase/migrations/0002_bot_discord.sql`** — que é a fonte da verdade, com as
> políticas de RLS, as duas funções `security definer` e a retenção. O esboço abaixo fica como
> registro do desenho.

Duas mudanças, e as duas precisam aparecer **no site também**, senão as pontas divergem no primeiro
dia. No site elas viraram: campo **Personagem** no formulário de importação, o fuso do navegador
gravado em `perfil` a cada importação, e a seção **Vincular Discord**, que gera o código.

```sql
-- Personagem: lookup igual a spot (diretriz 10 — nome repetido vira id).
create table public.personagem (
  id   smallint primary key generated always as identity,
  nome text     not null unique
);
alter table public.sessao add column personagem_id smallint references public.personagem(id);

-- Perfil: vínculo com o Discord e o fuso herdado do navegador.
create table public.perfil (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  discord_id text unique,
  fuso       text not null default 'UTC'
);

-- Código de vínculo, uso único e vida curta.
create table public.codigo_vinculo (
  codigo     text        primary key,
  usuario_id uuid        not null references auth.users(id) on delete cascade,
  expira_em  timestamptz not null,
  usado_em   timestamptz
);
```

RLS explícita em todas, como manda a diretriz 26. `codigo_vinculo` em especial: o dono só enxerga o
código dele.

---

## Armadilhas

**1. ~~O sprite pode não aparecer no Discord.~~ RESOLVIDA POR DECISÃO: o bot não mostra sprites.**
Decidido em 2026-09-17 — embed é texto puro. O Discord busca imagens de embed **pelo servidor dele**,
para cachear no CDN próprio, e `static.tibia.com` responde **403 para quem não é navegador**
(verificado com `curl`, com e sem User-Agent de navegador e com Referer nosso; detalhes em
[tibia-apis.md](tibia-apis.md)) — era exatamente o caso que falharia. Hospedar no bucket do Supabase
resolveria, mas põe o 1 GB de storage na conta para ganhar enfeite. Se um dia isso mudar, o lugar é
`lib/discord/embed.ts`, que já tem o aviso no cabeçalho.

**2. Orçamento de 500 MB fica multiusuário.** A 896 bytes por hunt, o teto prático é ~410 mil
hunts. Um grupo de amigos leva anos; se abrir, a política de retenção da diretriz 12 deixa de ser
teoria.

**3. Rate limit do Discord.** Não estudado ainda. Relevante se `/ranking` ou `/viewstats` virarem
frequentes.

**4. O proxy de auth engolia o endpoint — e isso já aconteceu.** Encontrado na verificação em
2026-09-17, não em teoria: `proxy.ts` redireciona quem não tem sessão para `/auth/login`, e o
Discord não manda cookie nenhum. Toda interação levava **307** e o bot nunca respondia. O sintoma do
lado do Discord é mudo — só "a aplicação não respondeu".

Corrigido excluindo `api/discord` do `matcher`. Quem autentica aquele endpoint é a assinatura
Ed25519, não o cookie. **Qualquer rota nova de bot precisa entrar nessa exclusão.**

**5. `create or replace view` não sobrevive a coluna nova em `sessao`.** Aconteceu ao rodar o
`0002` em 2026-09-17:

```
ERROR: cannot change name of view column "balance" to "personagem_id"
```

`sessao_periodo` é `select s.*, …`. Ao acrescentar `personagem_id` a `sessao`, o `*` passou a
expandir uma coluna a mais **no meio**, e tudo que vinha depois andou uma casa. `create or replace
view` só sabe acrescentar coluna no fim — exige nome, tipo e **posição** iguais para as que já
existem —, então ele leu o deslocamento como uma renomeação.

Correção: `drop view if exists` antes do `create view`. View não guarda dado, é consulta salva.
**Toda coluna nova em `sessao` vai reproduzir isso** — o migration que a adicionar tem de dropar a
view junto.

Detalhe que veio de brinde: o `security_invoker` agora vai **inline no `create view`**, não num
`alter view` depois. Entre um `create` nu e o `alter` existe um instante em que a view roda com os
privilégios do dono e ignora a RLS.

---

## A verificar

O que **não** deu para confirmar na documentação e precisa de teste na implementação:

1. **Argumento de slash command é visível para terceiros no canal?** É o comportamento conhecido e
   a razão de o `/cadastro` usar modal, mas a doc oficial não trata do assunto. Se for falso, o
   modal continua sendo melhor UX de qualquer forma.
2. **Multilinha em argumento de texto** — a doc confirma `max_length` até 6.000, mas não diz nada
   sobre quebra de linha. Idem: o modal resolve independente da resposta.
3. ~~**O proxy de imagem do Discord leva 403 do `static.tibia.com`?**~~ Deixou de importar: o bot
   não mostra sprites (armadilha 1).
4. **Quantos componentes cabem num modal.** A referência de componentes não explicita; sabemos que
   mensagem aceita até 40. Três campos, que é o que `/addhunt` precisa, está seguro.
5. ~~**O segredo HS256 legado ainda é aceito neste projeto Supabase?**~~ **Sim, verificado em
   2026-09-17** com `scripts/checar-jwt.ts`. Ver "O que a implementação descobriu".
6. **`after()` segura a instância na Vercel até o `PATCH` sair?** Em `next dev` foi verificado que
   ele roda depois da resposta e que o erro dentro dele é capturado (o follow-up saiu e levou
   `404 Unknown Webhook`, que é o esperado com token falso). **Na Vercel, não.** É o comportamento
   documentado (`waitUntil`), mas se falhar o sintoma é claro: o comando responde "pensando…" e
   nunca conclui.

### O que já foi verificado

Contra o handler de verdade, por HTTP, em `next dev` (2026-09-17) — chave Ed25519 de teste, gerada e
descartada:

| Entrada | Resposta |
|---|---|
| `PING` assinado | `200 {"type":1}` |
| sem cabeçalho de assinatura | `401` |
| corpo adulterado depois de assinado | `401` |
| `/addhunt` e `/cadastro` | `type: 9` (modal), sem defer |
| `/viewstats` | `type: 5` com `flags: 64` (efêmera) |
| `/viewstats publico:true` | `type: 5` sem flag |

---

## Como colocar no ar

Nada disto foi executado — o bot está escrito e testado offline, não rodado.

**1. Aplicar o schema.** `supabase/migrations/0002_bot_discord.sql` no SQL Editor, depois do `0001`.
Conferir no fim com a consulta que o próprio arquivo traz: nenhuma tabela de `public` pode voltar com
`rowsecurity = false`.

**2. Criar o app no Discord.** No Developer Portal: nova aplicação, aba Bot. De lá saem
`DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID` e `DISCORD_BOT_TOKEN`.

**3. Variáveis de ambiente.** Ver `.env.example`. Na Vercel só precisam existir
`DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID` e `SUPABASE_JWT_SECRET` — o token do bot é usado
apenas pelo script de registro, e o follow-up das interações se autentica com o token da própria
interação. **Nenhuma delas com prefixo `NEXT_PUBLIC_`** (diretriz 26).

**4. Registrar os comandos.**

```bash
node --experimental-strip-types --env-file=.env.local scripts/registrar-comandos.ts
```

Registra no servidor de `DISCORD_GUILD_ID`, onde aparecem na hora. Com `--global` leva até uma hora
para propagar.

**5. Apontar a Interactions Endpoint URL** para `https://lootibia.vercel.app/api/discord`. O Discord
valida no ato mandando requisições assinadas **e** requisições propositalmente quebradas: se o
endpoint não devolver `401` para as inválidas, ele recusa a URL. É o que `assinaturaConfere` cobre.

**6. Fluxo de fumaça, nesta ordem:** `/cadastro` com um código gerado em `/hunts` → `/addhunt` com
uma sessão de verdade → `/viewstats`. Depois `/addhunt` com a MESMA sessão, que tem de responder
"Sessão já importada" (o `23505` do `unique (usuario_id, inicio)`).

## Fontes

- Interações, janela de 3 s e defer: <https://docs.discord.com/developers/interactions/receiving-and-responding>
- `max_length` de opção (6.000): <https://docs.discord.com/developers/interactions/application-commands>
- Text Input em modal (4.000, short/paragraph): <https://docs.discord.com/developers/components/reference>
