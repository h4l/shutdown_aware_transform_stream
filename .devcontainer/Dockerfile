FROM curlimages/curl AS deno
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/tmp/deno sh

# We need node to run standard-version in the release process, so using the
# node devcontainer image as a base gives us node plus a decent dev environment.
FROM mcr.microsoft.com/vscode/devcontainers/javascript-node:0-16-bullseye
COPY --from=deno /tmp/deno /opt/deno
ENV PATH=/opt/deno/bin:${PATH}
CMD deno
