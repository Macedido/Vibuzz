# Status do projeto

Atualizado em 06/11/2026 · versão 1.1.0

## Funcionalidades concluídas

**Fundação** — monorepo (npm workspaces), app Expo SDK 58 com Expo Router e TypeScript, identidade visual própria (tema escuro, verde-ácido + lilás, ícones gerados), navegação com 5 abas, API modular (Hono), Supabase com 10 migrations, login/cadastro com idade mínima, recuperação de senha, perfis.

**Personagens** — ficha estruturada (nome, gênero, idade, frase, aparência, biografia, personalidade, passado, fala, gostos, desgostos, medos, objetivos, hábitos, comportamentos, relações, universo, cenário, primeira mensagem, instruções); nada obrigatório além do nome; avatar e galeria; categorias e tags; público / por link / privado; classificação Livre / 13+ / 18+; versões imutáveis com prévia das mudanças e restauração; página do personagem; apagar (ou despublicar se outros conversam com ele).

**Criação com IA** — ideia em texto + até 4 imagens → ficha estruturada que não contradiz o criador; grupos inteiros; regenerar campo a campo; visão distingue 1 personagem / vários / cenário / sem referência / ambígua, separa traços de cada pessoa, pergunta qual pessoa usar e separa o observável do que não dá para saber.

**Motor de IA** — contexto completo por resposta, prompt com parte cacheável, proteção contra injeção, 3 níveis automáticos, fallback entre provedores e modelos, remoção automática de parâmetros não suportados, custo e latência registrados, mensagens claras quando algo não está configurado (`/v1/status`).

**Memória** — 7 categorias, consolidação com fontes, deduplicação, atualização e substituição, busca híbrida, resumos, escopo por conversa / integrante / ramificação, invalidação e reconstrução ao apagar, tela para ver, corrigir e apagar.

**Chat** — streaming, imagens, regenerar, continuar, editar (ramificar ou substituir), apagar (ocultar ou definitivo), ramificações navegáveis, fixar, favoritar, arquivar, pesquisa, troca de persona, criatividade, parar geração, estados de carregamento / erro / vazio.

**Personas** — criar, editar, excluir, duplicar, padrão, escolher ao iniciar, trocar durante a conversa.

**Grupos** — 2–8 integrantes com fichas próprias, orquestração de falas, memória individual e coletiva, mensagens privadas para um integrante.

**Comunidade** — início com recomendações, em alta, populares, novos, seguidos, grupos e “continue suas conversas”; descobrir com busca por nome / descrição / @criador / #tag, categorias, 5 ordenações e filtro de grupos; curtir, favoritar, avaliar 1–5, comentar, seguir, compartilhar link, perfis públicos, notificações.

**IA grátis e API serverless (1.1)** — API portátil (Hono) que roda em Node e no Supabase Edge Functions; modelos gratuitos sem chave (OVHcloud anônimo com 5 modelos em rodízio + Pollinations), Gemini grátis opcional, embeddings `gte-small` dentro do Supabase, worker por `pg_cron`, filtro de `<think>`, timeouts com troca automática de modelo, triagem local de segurança (menores e sinais de crise) quando a moderação por IA está desligada no chat privado.

**Segurança e operação** — RLS completa, moderação de texto e imagem por contexto, regras de idade, denúncias, bloqueio, limites por minuto e por dia, exclusão de conta (LGPD), termos e privacidade no app, fila de jobs com retentativa, limpeza periódica, Docker, Render, CI.

## Testes realizados

| Suíte | Comando | Resultado |
|---|---|---|
| Banco: migrations + RLS + funções em Postgres embutido (PGlite + pgvector) | `npm run test:db` | 77/77 |
| Banco real no Supabase (projeto `Vibuzz`, sa-east-1): cadastro, idade mínima, RLS, busca, curtidas — em transação desfeita | SQL | ok |
| Supabase Security Advisor | painel | só avisos esperados (`is_username_available`, `conversation_path`, tabelas só do servidor) |
| API: provedores, fallback, prompts, memória, moderação, HTTP/SSE, IA grátis, edge | `npm test` | 56/56 |
| Pacote edge rodando em Deno 2 (health, status, CORS, auth, tick) | `deno run` | ok |
| Typecheck shared + API + app | `npm run typecheck` | ok |
| Build da API e export web do app | `npm run build:api`, `build:web` | ok |
| Revisão visual das telas principais (web, dados simulados) | — | ok |
| Qualidade da IA com modelos reais (9 cenários) | `npm run eval -w @vibuzz/api` | **precisa de chave** — rode após configurar |

## Pendente / limitações conhecidas

- **Teste ponta a ponta com IA real** ainda não foi feito (faltam chaves de IA). O banco real já foi testado. Depois do setup: crie conta, crie um personagem com IA, converse, edite, apague, veja memórias, rode `npm run eval`.
- **Builds nativos** (EAS) não foram gerados aqui: exigem conta Expo. O app compila e roda na web; Android/iOS usam o mesmo código.
- **IA gratuita sem chave** é limitada (≈2 pedidos/min por modelo e por IP, qualidade média, às vezes lenta). Serve para testar e para poucos usuários; para lançar, adicione `GEMINI_API_KEY` (grátis) ou uma chave paga.
- No modo grátis, mensagens privadas não passam pelo classificador de IA (para não gastar o limite): valem as regras no prompt + triagem local de menores e de crise. Conteúdo público (fichas, perfis, comentários, imagens públicas) continua sempre moderado.
- **Push notifications:** só notificações dentro do app. Para push: `expo-notifications` + tabela de tokens.
- **Painel de moderação:** denúncias são revisadas pelo painel do Supabase (SQL em `SETUP.md`). Um painel web de admin é o próximo passo natural.
- **Personagens com vida própria:** arquitetura pronta (preferência, fila agendada, notificações); a geração dos acontecimentos ainda não foi implementada.
- **Billing:** fora do escopo (módulo futuro). `usage_records` já guarda custo por usuário.
- **Recomendações** usam gosto por categoria/tag, embeddings e seguidos; sem modelo treinado.
- Limite por minuto é por instância (memória); o limite diário fica no banco.

## Decisões técnicas

- **Postgres como fila** (em vez de Redis/BullMQ): uma dependência a menos, transacional com os dados, `SKIP LOCKED` para vários workers. Em serverless, `pg_cron` dispara o worker.
- **Hono** no lugar de Fastify: o mesmo app roda em Node e em Deno (Supabase Edge).
- **Mensagens em árvore** (`parent_id`) + folha ativa na conversa: ramificações, edições e regenerações sem duplicar históricos.
- **Memória ancorada em mensagens** (`memory_sources`): é o que permite exclusão consistente e isolamento entre ramificações.
- **Relações como eventos** ligados a mensagens, não números.
- **Leituras pelo app com RLS, escritas sensíveis pela API**: menos código de API e segurança garantida pelo banco.
- **SSE** para streaming (funciona em proxies comuns; `expo/fetch` lê o corpo no celular).
- **Anthropic por padrão** para chat/visão/criação e **OpenAI** para embeddings/moderação, ambos trocáveis por variável de ambiente.
- **Embeddings de 1536 dimensões** (padrão do `text-embedding-3-small`).

## Banco de dados

Tabelas: `users`, `user_profiles`, `blocks`, `personas`, `categories`, `tags`, `characters`, `character_versions`, `character_images`, `character_tags`, `character_groups`, `group_members`, `conversations`, `conversation_members`, `messages`, `message_branches`, `memories`, `memory_sources`, `memory_summaries`, `relationships`, `relationship_events`, `likes`, `favorites`, `ratings`, `follows`, `comments`, `reports`, `moderation_events`, `notifications`, `usage_records`, `jobs`. View: `character_cards`. Buckets: `media`, `chat`.

Funções principais: `discover_characters`, `recommend_characters`, `conversation_path`, `search_messages`, `match_memories`, `core_memories`, `nearest_memories`, `relationship_states`, `path_messages`, `path_summaries`, `derived_from_messages`, `subtree_ids`, `usage_today`, `enqueue_job`, `claim_jobs`, `creator_stats`, `is_username_available`.

## Integrações

| Integração | Variáveis | Estado |
|---|---|---|
| Supabase (banco, auth, storage) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EXPO_PUBLIC_SUPABASE_*` | **projeto criado e migrado** (`luqxzunlenpsjmfqxfxi`, São Paulo); falta configurar URLs de auth e colocar as chaves nos `.env` |
| IA grátis sem chave (OVHcloud anônimo, Pollinations) | `FREE_AI` (ligado por padrão) | implementado e testado a partir do Supabase |
| Gemini (grátis com conta Google) | `GEMINI_API_KEY` | implementado (endpoint compatível com OpenAI) |
| Embeddings no Supabase (`gte-small`) | automático no Edge | implementado |
| Anthropic | `ANTHROPIC_API_KEY` | implementado (streaming, visão, cache de prompt) |
| OpenAI | `OPENAI_API_KEY` | implementado (embeddings, moderação, chat opcional) |
| Compatível com OpenAI | `COMPAT_API_KEY`, `COMPAT_BASE_URL` | implementado |
| EAS / lojas | conta Expo | configurado (`eas.json`), aguardando conta |
