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
- [docs/bot-discord.md](docs/bot-discord.md) — póstumo do bot, e o que sobrou dele na `main`.

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

**Bot do Discord: APOSENTADO em 2026-09-22.** Esteve no ar de 17 a 22 de setembro. Na prática
ninguém usava, e manter uma segunda casca sobre o mesmo domínio saía mais caro do que valia. O
código inteiro vive na branch **`abandonado/bot-discord`**, que não recebe mais commits; o schema
dele foi derrubado por `supabase/migrations/0004_aposenta_bot_discord.sql`.

O que sobreviveu, e por quê, está em [docs/bot-discord.md](docs/bot-discord.md) — em resumo:
`lib/importacao.ts` (o núcleo compartilhado, que continua fora da UI), `lib/supabase/jwt.ts` (era
`bot.ts`; `scripts/testar-pastas.ts` depende dele para exercitar a RLS de verdade), a tabela
`personagem` e `perfil.fuso`.

Em aberto: o de-para de plural dos **itens** (`great mana potions` → `Great Mana Potion`) não
existe, e sem ele não dá para cruzar loot com `npcvalue` do wiki.

**Login por usuário e senha desde 2026-09-19.** Não existe
cadastro: o Davi cria as contas com `scripts/criar-usuario.ts`, que sorteia um código de ativação.
O código é a senha temporária; o site obriga a trocar no primeiro acesso. O modelo inteiro está em
[lib/conta.ts](lib/conta.ts) e o que não se negocia, nas diretrizes 38 a 40.

`supabase/limpar-contas.sql` foi rodado e as contas antigas, de e-mail e senha, não existem mais.

**O cadastro pela API já está desligado** — medido em 2026-09-19: `POST /auth/v1/signup` responde
`422 signup_disabled`. A diretriz 38 continua valendo como aviso para quem mexer no painel depois,
não como pendência. O `admin.createUser` do script não é afetado: a API de admin ignora essa
trava.

Duas coisas medidas contra o projeto real, não presumidas: o GoTrue trata `@lootibia.invalid` como
qualquer outro domínio no login (`invalid_credentials`, e não rejeição de formato), e o
`admin.createUser` **aceita** esse domínio — a primeira conta foi criada por
`scripts/criar-usuario.ts` e volta por `usuarioDoEmail` com o nome certo.

Falta exercitar de ponta a ponta o desvio do middleware para `/auth/definir-senha`: ele depende de
uma sessão real, e ninguém entrou ainda com um código.

**Pastas com meta, em implementação desde 2026-09-21.** A semana saiu da tela: quem organiza é a
PASTA, criada e nomeada pelo usuário, com meta opcional em TC ou gp. Schema em
`supabase/migrations/0003_pastas_e_metas.sql`. `lib/periodo.ts` **continua de pé** — deixou de ser
o eixo da interface e virou o motor que sabe a que dia de jogo um instante pertence, do qual depende
a cidade do Rashid (diretriz 42).

Novos módulos: [lib/meta.ts](lib/meta.ts) (progresso, conversão TC↔gp),
[lib/rashid.ts](lib/rashid.ts) (rotação semanal) e [lib/tibiadata.ts](lib/tibiadata.ts) (cliente
único da API, diretriz 15). Tela de `/config` para personagem e preço da TC.

**Identidade visual fechada em 2026-09-17.** Wordmark "lootibia" com a espada no lugar do `t`,
desenhado em vetor: grotesca geométrica pesada, `a` de um andar, punho na cor do texto e só a
lâmina em `--primary`. Geometria em [lib/marca.ts](lib/marca.ts), componentes em
[components/marca.tsx](components/marca.tsx), arquivos de imagem gerados por
`scripts/gerar-marca.ts` (diretriz 37). A cor chegou aos cinco lugares: tokens do site,
telas de auth, `app/icon.svg` + `favicon.ico` + `apple-icon.png` e cartão social. O quinto era a
cor dos embeds do bot do Discord, que foi aposentado em 22/09.

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
node --experimental-strip-types lib/marca.test.ts
node --experimental-strip-types lib/conta.test.ts
node --experimental-strip-types lib/metaRashid.test.ts
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

---

## Contas e acesso

Modelo completo em [lib/conta.ts](lib/conta.ts).

**38. Não existe cadastro, e desligar isso no painel faz parte da mudança.** Remover a tela de
`/auth/sign-up` é decoração: o endpoint `POST /auth/v1/signup` do GoTrue continua aceitando quem
souber o caminho. **"Allow new users to sign up" tem de ficar desligado** no painel do Supabase — hoje está, e
foi medido (`422 signup_disabled`), mas quem religar reabre o cadastro sem tocar numa linha de
código. A API de admin, que o script usa, ignora essa trava e continua criando conta normalmente.

**39. `SUPABASE_SECRET_KEY` nunca vai para a Vercel.** Ela ignora a RLS inteira e serve só a
`scripts/criar-usuario.ts`, rodado na máquina do Davi. O site em produção não precisa dela: o
primeiro acesso é um `signInWithPassword` comum e a troca de senha é um `updateUser`, os dois com
a chave publicável. Pôr a secreta em produção aumentaria a superfície sem destravar recurso nenhum.

**40. `senha_definida` é porteiro de fluxo, não fronteira de segurança.** A flag vive em
`user_metadata`, que o próprio dono consegue gravar — quem quiser vira a flag sem trocar a senha.
O que ele ganha é continuar com uma senha que o Davi mandou por Discord; não ganha dado de mais
ninguém, porque quem isola continua sendo a RLS. A segurança real está no código de ativação ser
um segredo de ~49 bits sorteado com `crypto.getRandomValues`. Não transformar essa flag em
autorização de coisa alguma.

**41. Transição de autenticação usa navegação DURA, nunca `router.push`.** Login, definir senha e
sair trocam `window.location.assign`. `router.push` é navegação do cliente: serve o que estiver no
Router Cache do Next — inclusive uma cópia pré-buscada enquanto a sessão era outra — e pode não
passar pelo middleware com o cookie recém-gravado. O sintoma é o primeiro acesso exigir vários F5
até "destravar", que é o que aconteceu em 2026-09-21. Uma carga de página inteira por login é
preço barato.

Duas armadilhas irmãs, do mesmo episódio:

- **`updateUser` não reemite o access token.** Depois de trocar a senha, o JWT no cookie ainda diz
  `senha_definida: false` e o middleware devolve o usuário para a tela de senha. Tem de chamar
  `refreshSession()` antes de navegar.
- **O middleware distingue "sem sessão" de "não consegui verificar".** Com chave assimétrica
  (ES256), `getClaims()` busca o JWKS na rede — ~750 ms medidos — e em instância fria isso falha.
  Aí vem `error` preenchido com o cookie ainda válido; tratar como deslogado vira soluço de rede
  em sessão perdida. Sem sessão é `data` e `error` os dois nulos, e só isso manda para o login.

**42. `lib/periodo.ts` não é código morto.** A semana saiu da tela em 2026-09-21, o `/viewstats`
do bot morreu em 22/09, e a tentação seguinte é apagar o motor de dia do jogo. **Não apague.**

Ele é quem sabe que **o dia de Tibia vira no server save**, às 10:00 de Berlim. Hoje quem depende
disso é a cidade do Rashid — e sim, é um consumidor só. Não é motivo para apagar: o dia do jogo é
uma regra do domínio, não um detalhe de tela, e ela volta a fazer falta na primeira vez que alguém
perguntar "quanto rendeu hoje".

O Rashid muda de cidade no server save, não à meia-noite. Com `Date.getDay()` ele ficaria errado
**10 horas por dia, todo dia** — às 08:00 de uma terça ele ainda está na cidade de segunda.
`lib/metaRashid.test.ts` trava exatamente esse caso.

A rotação é arquivo versionado e não chamada de API, pelo motivo da diretriz 33: a TibiaData **não
tem endpoint de NPC** (conferido nos 20 caminhos da v4), e sete strings que nunca mudam não
justificam dependência de rede no caminho da requisição. A origem é o TibiaWiki, onde os campos
`city`…`city7` e a prosa de `notes` concordam entre si.

**43. A TibiaData tem QUATRO formatos de resposta, não um.** A tabela está no topo de
`lib/tibiadata.ts`, e três dos quatro só apareceram batendo na API de verdade:

| Caso | HTTP | Corpo |
|---|---|---|
| achou | 200 | envelope, `information.status.http_code = 200` |
| personagem não existe | **502** | `error code: 502` em **texto puro**, sem envelope |
| nome inválido | 422 | `{"message":"…"}` em JSON, sem envelope |
| mundo não existe | 200 | envelope com `status.error = 11002` |

"Não existe" é **resposta**, não falha: devolver `null`, nunca lançar. Tratar o 502 como erro faz
"personagem não encontrado" virar "a TibiaData está fora do ar", e o usuário vai conferir a
conexão em vez do nome que digitou.

**44. Boostado do dia e gente online são buscados PELO NAVEGADOR.** Mudam rápido demais para
virar arquivo versionado (diretriz 33) e com frequência demais para o servidor rebuscar a cada
requisição (diretriz 17). A TibiaData responde `Access-Control-Allow-Origin: *` — verificado —,
então o navegador busca direto, o cache HTTP dele respeita o `max-age` que a API manda, e o nosso
servidor não entra na conta. Busca de personagem é o oposto: acontece uma vez, numa ação de
usuário, e por isso roda no servidor.

**45. RLS sem política de `update` nega EM SILÊNCIO — e o PostgREST responde sucesso.** Aconteceu
em 2026-09-21: `sessao` tinha select, insert e delete desde o 0001, e nada mais. Mover uma hunt
para uma pasta é `update sessao set pasta_id`; o Postgres não encontrava linha alguma que a
política permitisse tocar, atualizava zero linhas, e a API devolvia **200 sem erro**. A tela não
tinha como saber, e o sintoma era "clico e não acontece nada".

Ao criar tabela ou ao passar a editar uma coluna que ninguém editava, conferir os **quatro** verbos:

```sql
select tablename, cmd, policyname from pg_policies
 where schemaname = 'public' order by tablename, cmd;
```

Toda política de `update` leva `using` **e** `with check`. Só com `using`, eu alcanço a minha
linha e gravo nela o `usuario_id` de outra pessoa.

**46. Regra que vive no Postgres precisa de teste que fale com o Postgres.** Nenhum teste de
`lib/` pegaria a diretriz 45: não há lógica errada, o `tsc` está feliz e a chamada "funciona".
`scripts/testar-pastas.ts` existe para essa classe — ele assina um JWT de usuário e exercita a
RLS pelo mesmo caminho da tela:

```bash
node --experimental-strip-types --env-file=.env.local scripts/testar-pastas.ts
```

Duas regras: ele **relê do banco** em vez de confiar no retorno da chamada — era exatamente o
retorno que mentia —, e **não entra na diretriz 3**, porque precisa de credencial e de rede, e a
lista de validação tem de rodar em qualquer máquina.

Ele assina um JWT de usuário com `lib/supabase/jwt.ts`, e é isso que o torna válido: a chave
secreta ignoraria a RLS, que é justamente o que se quer testar.

Se precisar saber se a culpa é da RLS, repita a operação com a chave secreta, que a ignora: se
funcionar lá e não com o JWT, é política faltando.
