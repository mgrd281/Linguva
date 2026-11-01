# The pages as DeepL alone shows them: this image has no engine configuration (it can't see the
# app's), so the multi-engine texts and every engine block but DeepL's are dropped at build time,
# the same as applyEngineBlocks(html, DEEPL_ONLY) in app/.server/site/engine-blocks.ts (nested
# blocks go with their parent; the remaining single/deepl markers are invisible comments).
# A deployment with more engines serves privacy.html, support.html, index.html and preise.html
# from the app, not from this image.
FROM alpine:3.20 AS pages
RUN apk add --no-cache perl
COPY *.html /pages/
RUN perl -0pi -e 's/<!--engines:several-->.*?<!--\/engines:several-->//gs; s/<!--engines:multi-->.*?<!--\/engines:multi-->//gs; 1 while s/<!--engine:(?!deepl-->)([a-z-]+)-->.*?<!--\/engine:\1-->//gs' /pages/*.html

FROM caddy:2.10.2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=pages /pages/*.html /srv/
COPY assets /srv/assets
