# Bot do Discord — desenho

> **STATUS: DESENHO. Nada implementado.** Escrito em 2026-09-17 a partir da conversa de desenho.
> Limites do Discord citados aqui foram conferidos na documentação oficial na mesma data; o que
> **não** deu para confirmar está marcado como tal na seção "A verificar".

Este documento existe para que a implementação comece sem depender da conversa que o originou.
Leia junto com [AGENTS.md](../AGENTS.md) — as 33 diretrizes continuam valendo.

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

**Decisão em aberto: resposta pública ou efêmera?** Num grupo de amigos, pública faz mais sentido
(a graça é comparar), mas é escolha do Davi.

### `/ranking` — o que justifica o bot existir

Comparar profit/h entre os membros do grupo é a única coisa aqui que um bot faz melhor que uma
página web. Se for para ter um quarto comando, é este.

Atenção: cruza dados entre usuários, então **não pode** rodar com a RLS escopada num único usuário.
Precisa de uma consulta agregada deliberada, e de todo mundo ciente de que os números aparecem para
o grupo.

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

**Recomendado: 3.** Depois que o vínculo existe, assinar o JWT com o segredo do projeto é umas 20
linhas a mais e mantém a RLS como quem garante o isolamento, em vez do código do bot. Como é
círculo fechado, a opção 1 é defensável — mas é uma escolha, não um padrão.

A chave secreta, em qualquer caso, **nunca** em variável `NEXT_PUBLIC_*` (diretriz 26).

---

## Delta de schema

Duas mudanças, e as duas precisam aparecer **no site também**, senão as pontas divergem no primeiro
dia:

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

**1. O sprite pode não aparecer no Discord.** O Discord busca imagens de embed **pelo servidor
dele**, para cachear no CDN próprio — e `static.tibia.com` responde **403 para quem não é
navegador** (verificado com `curl`, com e sem User-Agent de navegador e com Referer nosso; detalhes
em [tibia-apis.md](tibia-apis.md)). É exatamente o caso que falha. **Precisa testar antes de
prometer sprite no embed.** Se falhar: hospedar os sprites no bucket do Supabase (aí o 1 GB de
storage entra na conta) ou aceitar embed sem imagem.

**2. Orçamento de 500 MB fica multiusuário.** A 896 bytes por hunt, o teto prático é ~410 mil
hunts. Um grupo de amigos leva anos; se abrir, a política de retenção da diretriz 12 deixa de ser
teoria.

**3. Rate limit do Discord.** Não estudado ainda. Relevante se `/ranking` ou `/viewstats` virarem
frequentes.

---

## A verificar

O que **não** deu para confirmar na documentação e precisa de teste na implementação:

1. **Argumento de slash command é visível para terceiros no canal?** É o comportamento conhecido e
   a razão de o `/cadastro` usar modal, mas a doc oficial não trata do assunto. Se for falso, o
   modal continua sendo melhor UX de qualquer forma.
2. **Multilinha em argumento de texto** — a doc confirma `max_length` até 6.000, mas não diz nada
   sobre quebra de linha. Idem: o modal resolve independente da resposta.
3. **O proxy de imagem do Discord leva 403 do `static.tibia.com`?** Ver armadilha 1.
4. **Quantos componentes cabem num modal.** A referência de componentes não explicita; sabemos que
   mensagem aceita até 40. Três campos, que é o que `/addhunt` precisa, está seguro.

## Fontes

- Interações, janela de 3 s e defer: <https://docs.discord.com/developers/interactions/receiving-and-responding>
- `max_length` de opção (6.000): <https://docs.discord.com/developers/interactions/application-commands>
- Text Input em modal (4.000, short/paragraph): <https://docs.discord.com/developers/components/reference>
