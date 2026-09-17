# lootibia — diretrizes de trabalho

Projeto em Tibia apoiado em três fontes públicas: **TibiaData API** (dados vivos do jogo),
**TibiaWikiApi / tibiawiki.dev** (dados estáticos do wiki) e o **TibiaWiki** por trás dela.
Stack: **Next.js 16 (App Router, Cache Components)** + **Supabase Free** + **Vercel Hobby** +
**Tailwind v3 via PostCSS** (decidido em 2026-09-16 — ver diretriz 25).

Referências técnicas verificadas — **ler antes de escrever código que toque nessas áreas**:
- [docs/tibia-apis.md](docs/tibia-apis.md) — shapes reais, TTLs e armadilhas das duas APIs.
- [docs/stack.md](docs/stack.md) — limites reais dos planos gratuitos, Supabase+Next.js, RLS, Tailwind.
- [docs/hunt-analyser.md](docs/hunt-analyser.md) — formato do Hunt Analyser e dimensionamento.
- [docs/periodos.md](docs/periodos.md) — dia e semana do jogo (server save).
- [docs/bot-discord.md](docs/bot-discord.md) — desenho e implementação do bot, e as armadilhas encontradas.

## Escopo

**Analisador de Hunts.** O usuário cola o texto que o Hunt Analyser do Tibia copia, o app parseia,
guarda a sessão e mostra os acumulados do período (semana, por padrão): profit e loot acumulados,
XP e XP Raw, supplies total e média, profit/loot médio, médias de XP e XP Raw, mobs mortos no
período e hunts mais caçadas.

Duas regras de cálculo que não se negociam:

- **Toda taxa é `Σ total / Σ horas`, nunca a média das médias por sessão.** Uma hunt de 10 min com
  XP/h inflado pesaria igual a uma de 4 h. No caso testado a diferença é de 120 mil/h contra 350 mil/h.
- **`Balance` e as taxas `/h` do texto não se persistem.** `Balance` é `Loot − Supplies`; os `/h` do
  jogo não são reproduzíveis por nenhuma duração única e servem só para diagnóstico.

Detalhes do formato, armadilhas e dimensionamento: [docs/hunt-analyser.md](docs/hunt-analyser.md).
Agrupamento por dia e semana do jogo: [docs/periodos.md](docs/periodos.md).

**Estado em 2026-09-17:** app no ar em <https://lootibia.vercel.app>, schema de
`supabase/migrations/0001_schema.sql` **aplicado e verificado** no Supabase — importação, RLS
isolando por usuário e a view `sessao_periodo` concordando com `lib/periodo.ts` foram conferidas de
ponta a ponta. A tela `/hunts` importa, lista, apaga e mostra o acumulado da semana com sprites.

**Bot do Discord: NO AR e em uso desde 2026-09-17.** Três comandos (`/cadastro`, `/addhunt`,
`/viewstats`) num endpoint de HTTP Interactions em `app/api/discord/route.ts`, servido pelo mesmo
deploy da Vercel — não há processo nem host a mais. `supabase/migrations/0002_bot_discord.sql`
aplicado e conferido (RLS ligada em toda tabela nova; `sessao_periodo` recriada com
`personagem_id`). App `Lootibia` registrado no Discord, endpoint validado por ele, comandos
registrados no servidor com `scripts/registrar-comandos.ts`.

Três coisas foram provadas em produção, não presumidas: o Discord **aceitou** a Interactions
Endpoint URL (ou seja, a verificação Ed25519 responde `200` ao `PING` assinado e `401` ao lixo); o
Supabase **aceita** o JWT que o bot assina (`scripts/checar-jwt.ts`); e o `after()` **roda na
Vercel**, o que se conclui de `/cadastro` e `/addhunt` concluírem — todo o trabalho deles acontece
lá dentro (diretriz 35).

Em aberto: as quatro telas de auth seguem em inglês (vêm do template); o de-para de plural dos
**itens** (`great mana potions` → `Great Mana Potion`) não existe, e sem ele não dá para cruzar loot
com `npcvalue` do wiki; `/ranking` e o `/hunts` do bot ficaram fora da primeira entrega; e o JWT do
bot depende do segredo HS256 legado do Supabase continuar aceito (ver diretriz 34).

**Identidade visual fechada em 2026-09-17.** Wordmark "lootibia" com a espada no lugar do `t`,
desenhado em vetor: grotesca geométrica pesada, `a` de um andar, punho na cor do texto e só a
lâmina em `--primary`. Geometria em [lib/marca.ts](lib/marca.ts), componentes em
[components/marca.tsx](components/marca.tsx), arquivos de imagem gerados por
`scripts/gerar-marca.ts` (diretriz 37). A cor chegou aos cinco lugares: tokens do site,
telas de auth, `app/icon.svg` + `favicon.ico` + `apple-icon.png`, cartão social, e `COR`/`COR_ERRO`
em `lib/discord/protocolo.ts` — que deixaram de ser o verde genérico herdado do template.

---

## Git e validação

**1. `git commit`, `git push` e `git pull` só com aprovação explícita do Davi, e só depois dos
testes de validação passarem.** Sem exceção, sem "commit rápido". Nunca encadear commit e push na
mesma ação sem que cada um tenha sido pedido.

**2. Ordem obrigatória antes de pedir aprovação:** rodar a validação → mostrar o resultado real →
mostrar o que será commitado (`git status` + `git diff`) → pedir aprovação → só então executar.
Se a validação falhar, reportar a falha com a saída; não pedir aprovação de código quebrado.

**3. "Testes de validação" são estes quatro comandos**, nesta ordem, todos passando:

```bash
npx tsc --noEmit
npx eslint .
npm run build
node --experimental-strip-types lib/periodo.test.ts
node --experimental-strip-types lib/hunt.test.ts
node --experimental-strip-types lib/sprites.test.ts
node --experimental-strip-types lib/discord.test.ts
node --experimental-strip-types lib/marca.test.ts
```

Conforme o projeto crescer, esta lista cresce junto — mantê-la atualizada aqui.

**4. Nunca commitar na branch principal direto**, nunca usar `--no-verify`, nunca `push --force`,
e nunca reescrever histórico já publicado sem pedido explícito.

---

## Armazenamento — orçamento de 500 MB

**5. O teto real do banco é 500 MB, não 1 GB.** No Supabase Free, 500 MB é o banco e 1 GB é o
*file storage* (bucket), que é um contador separado. Todo dimensionamento parte de 500 MB.

**6. Não armazenar o que pode ser recalculado ou rebuscado.** Drop rate se calcula de `times/kills`
— guarda-se os dois inteiros, nunca o percentual. Nada de coluna derivada persistida sem motivo
medido.

**7. Nunca gravar payload cru de API no banco.** Guardar JSON de resposta "por garantia" é o jeito
mais rápido de queimar 500 MB. Cache de resposta vive fora do Postgres: ISR/cache da Vercel,
arquivo de build, ou memória do processo.

**8. Nada de binário no Postgres.** Imagens do wiki e do tibia.com já são hospedadas na origem —
guardar a URL ou só o nome da página. Se precisar hospedar, é o bucket de Storage, não o banco.

**9. Tipos estreitos por padrão.** `int4` em vez de `bigint` quando 2,1 bilhões bastam (e bastam
para tudo aqui); `smallint` para contadores pequenos; `date` (4 bytes) quando não precisa de hora;
inteiro de centavos/permilagem em vez de `numeric`. PK `identity` inteira em vez de UUID (4 bytes
contra 16, multiplicado por toda FK que referencia).

**10. Normalizar strings repetidas em tabelas de lookup.** Nome de item e de criatura se repetem
milhares de vezes em dados de loot; armazenar a string em cada linha é desperdício puro. Linha de
loot referencia `item_id` e `creature_id`, não texto.

**11. Todo índice custa espaço.** Criar índice só para consulta que existe de verdade, preferir
índice parcial/composto ao invés de vários avulsos, e remover o que não for usado.

**12. Toda tabela que cresce com o tempo nasce com política de retenção definida.** Histórico e
séries temporais sem regra de expurgo são o segundo jeito mais rápido de estourar o limite.
Definir a regra no mesmo commit que cria a tabela.

**13. Medir, não estimar.** Antes de qualquer carga em massa, medir com
`pg_size_pretty(pg_total_relation_size('tabela'))` e `pg_database_size(current_database())`, e
registrar o número. Tupla morta conta para o tamanho — considerar `VACUUM` após deleção grande.

---

## Integração com as APIs de Tibia

**14. Nunca inferir o formato de uma resposta.** Consultar `docs/tibia-apis.md` ou fazer a chamada
real. As duas APIs divergem do que a documentação delas promete, e a TibiaWikiApi não tem contrato
estável — ela espelha templates de wiki que mudam sem aviso.

**15. Todo acesso passa por uma camada de cliente única, por API.** Nenhum `fetch` solto espalhado
pelo código. Cada cliente concentra URL base, `User-Agent` identificável, timeout, retry, cache e
normalização.

Hoje o único código que chama a TibiaData é `scripts/atualizar-criaturas.ts`, rodado à mão. A tela
**não faz chamada de API nenhuma** — lê `lib/dados/criaturas.ts`, versionado. O motivo está na
diretriz 33.

**16. Nunca confiar apenas no status HTTP.** TibiaData devolve `502 text/plain` para recurso
inexistente (não 404) e `400` com JSON válido para erro de validação — a verdade está em
`information.status.error`. TibiaWikiApi devolve `404` com corpo vazio. Parsear defensivamente.

**17. Respeitar os TTLs reais como piso do cache local** (60 s a 900 s na TibiaData; 60 s na
TibiaWikiApi — tabela em `docs/tibia-apis.md`). Cachear menos que isso só gera tráfego sem dado novo.

**18. Concorrência baixa contra tibiawiki.dev**: pool de 2 threads e fila de 32 do outro lado
(`503` quando enche). Máximo de 2–3 requisições simultâneas, com backoff. Carga em massa é **job
offline**, nunca requisição de usuário.

**19. Nada de `?expand=true` em categorias grandes** — teto de 5.000 páginas; `items` já estoura
(6.560 → `413`).

**20. Somente leitura.** A TibiaWikiApi expõe `PUT` para editar o wiki; está desabilitado na
instância pública e fora do escopo deste projeto.

---

## Dados

**21. Normalizar na borda, tipar no domínio.** A TibiaWikiApi devolve tudo como string, com markup
de wiki embutido (`[[Link]]`, `{{Template|...}}`, `"--"` como vazio). Parsers dedicados convertem
no ponto de entrada; o resto do código nunca vê string crua de wiki. Campo ausente é normal, não erro.

**22. Loot stats são amostra de jogadores, não verdade oficial.** Sempre exibir `kills` junto de
qualquer porcentagem. `"Empty"` é kills sem loot: excluir de rankings de item.

**23. Junção entre as duas APIs exige mapeamento explícito.** TibiaData usa slug de `race`
(`dragon`), o wiki usa título de página (`Dragon`). Manter tabela de mapeamento versionada, com
fallback e teste para os nomes que divergem.

**24. Preço de Market não existe em nenhuma das duas APIs** — só `npcvalue`/`value` do wiki, que é
referência de NPC. Não inventar número e apresentar como preço.

---

## Stack e deploy

**25. A stack é Next.js (App Router) + `@tailwindcss/postcss`, via
`npx create-next-app@latest -e with-supabase`.** Decidido em 2026-09-16. **Vite/SPA está
descartado** e o guia de Tailwind com Vite (`@tailwindcss/vite`) **não se aplica** a este projeto.

Motivo decisivo: **`tibiawiki.dev` não envia `Access-Control-Allow-Origin` para origens externas**
(verificado; `api.tibiadata.com` envia `*`). O browser bloqueia a resposta, então um SPA não
alcança a API de loot — o dado central do projeto — sem um proxy de servidor. Com Vite seriam duas
peças para manter em vez de uma.

Reforços: ISR (diretriz 28) e o endpoint invocado pelo cron (diretriz 27) só existem com servidor;
o cache de `fetch` do Next.js atende às diretrizes 7 e 17 sem tocar no Postgres; e a chave
`service_role` do Supabase, necessária para o ETL escrever ignorando RLS, não pode existir em
bundle de browser.

Consequência prática: Tailwind não se instala à mão — o template já traz TypeScript, Tailwind e
auth por cookie configurados. **Atenção: o template entrega Tailwind v3.4.1**, com
`tailwind.config.ts` e `autoprefixer`, não a v4 do guia oficial. Migrar para v4 é opção em aberto,
não pendência.

**26. RLS ligada em toda tabela, desde a criação.** A chave publicável do Supabase roda no browser:
sem Row Level Security a tabela é pública para leitura e escrita. `alter table ... enable row level
security` + políticas explícitas no mesmo migration que cria a tabela. Segredo nunca em
`NEXT_PUBLIC_*`.

**27. ETL periódico cabe em 1 execução diária.** Cron na Vercel Hobby roda **no máximo uma vez por
dia**, com ±59 min de imprecisão, e a função tem teto de 60 s. Job que não couber nisso roda fora
da Vercel — projetar para isso desde o começo, e usá-lo também para manter o projeto Supabase
acordado (pausa após 1 semana de inatividade).

**28. Dado de wiki que muda pouco vai para ISR, não para o banco.** Revalidação por tempo resolve a
maior parte dos casos sem consumir os 500 MB.

**33. `use cache` não é cache confiável em serverless.** A documentação do Next é explícita: com o
handler em memória padrão, "serverless instances are ephemeral, so entries may not be reused between
requests". Na Vercel, um `'use cache'` numa lista externa significaria rebuscá-la a cada
carregamento de página — o oposto da diretriz 17. Para dado que muda raramente (a lista de
criaturas muda só quando o jogo ganha bicho novo), **versionar um arquivo gerado é melhor que
cachear**: custo zero, diff auditável e nenhuma dependência de terceiro no caminho da requisição.
`'use cache: remote'` é durável mas, segundo a própria documentação, "incurs platform fees".

**32. Next.js 16 com Cache Components muda as regras de renderização.** `export const dynamic` foi
removido e **ler `cookies()` fora de um `<Suspense>` é erro de build** — o que inclui todo uso do
cliente Supabase de servidor. O padrão é: shell estático na página, dados do usuário num componente
`async` atrás da fronteira. A documentação da versão instalada está em
`node_modules/next/dist/docs/` e é a fonte a consultar, não a memória.

---

## Bot do Discord

Desenho completo em [docs/bot-discord.md](docs/bot-discord.md). O que não se negocia:

**34. A identidade do bot passa por JWT assinado, não por `service_role`.** Depois que
`/cadastro` vinculou `discord_id → usuario_id`, `lib/supabase/bot.ts` assina um token com
`sub = usuario_id` e **a RLS continua sendo quem isola os dados**. Com `service_role` o isolamento
passaria a depender de cada `.eq('usuario_id', …)` do código — e `where` esquecido é bug comum,
enquanto política de RLS não se esquece sozinha.

Ressalva registrada: o projeto Supabase usa chaves **assimétricas (ES256)**, cuja privada não é
exportável. A assinatura é em **HS256 com o segredo legado**, que o painel marca como
`still used — used only to verify JWTs`. **Verificado em 2026-09-17** com
`scripts/checar-jwt.ts`: token do bot aceito (`200`), token forjado recusado (`401`).

Vale enquanto o segredo não for revogado. Se for, `lib/supabase/bot.ts` é o único arquivo a
reescrever — todo o resto do bot fala com `clienteDoUsuario` e não sabe como o token nasceu. O
sintoma será `401` sem explicação em qualquer comando; rodar `checar-jwt.ts` aponta a causa.

**35. Trabalho de bot sempre atrás de `after()`.** Em serverless a invocação morre quando o handler
retorna: sem `after()` (que na Vercel vira `waitUntil`), o que vem depois do defer simplesmente não
roda e o usuário fica olhando "pensando…" para sempre. A exceção é o **modal, que precisa ser a
resposta inicial** — não existe adiar e abrir modal depois.

**36. A assinatura Ed25519 é verificada sobre o corpo CRU.** Ler com `req.text()` e só então
`JSON.parse`. Reserializar o objeto muda o texto e invalida a assinatura. Devolver `401` para
assinatura inválida não é zelo: o Discord manda requisições quebradas de propósito e recusa
registrar a URL que não reagir assim.

---

## Código

**29. Testes contra fixtures gravadas, nunca contra a API ao vivo.** Respostas reais em
`test/fixtures/`, parsers testados contra elas. Um script separado revalida as fixtures contra a
API de verdade, rodado sob demanda.

**30. Atribuição obrigatória em qualquer interface pública.** Tibia e produtos relacionados são
© CipSoft GmbH; creditar `tibia.com` (via TibiaData) e o TibiaWiki (via tibiawiki.dev).

**31. Comentários e commits em português**, acompanhando o padrão dos outros repositórios do autor.

**37. As letras da marca são desenhadas, não tipografadas.** `lib/marca.ts` não tem um `<text>`
sequer: cada letra é `<rect>`, `<circle>` ou `<path>`. Não é purismo. O favicon e o cartão social
saem de `sharp`, que rasteriza SVG **fora do navegador** e usa as fontes da máquina de quem rodar o
gerador — texto ali sai diferente em cada máquina, ou não sai. `lib/marca.test.ts` trava isso.

Consequência: `o`, `b` e `a` são um caminho só, contorno externo mais olho, com
`fill-rule="evenodd"`. Anel de traço mais retângulo de haste **não encosta**: com bojo de raio 28 e
haste tangente de 16, os dois só se cruzam em y=47,7, abaixo do topo da altura-x, e sobra um degrau
de fundo de 4,58 — imperceptível em 22 px, escancarado em 1200.

Os arquivos de imagem são versionados e regerados à mão, pelo mesmo motivo da diretriz 33:

```bash
node --experimental-strip-types scripts/gerar-marca.ts
```
