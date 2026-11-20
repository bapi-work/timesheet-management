FROM nginx:alpine

# Used once at startup to create a temporary certificate when none exists yet
RUN apk upgrade --no-cache && apk add --no-cache openssl

COPY --chmod=755 ensure-cert.sh /docker-entrypoint.d/05-ensure-cert.sh
