FROM node:18.13@sha256:d871edd5b68105ebcbfcde3fe8c79d24cbdbb30430d9bd6251c57c56c7bd7646

WORKDIR /opt/azurite

RUN apk update && apk upgrade && \
    apk add --no-cache bash git openssh

RUN git clone https://github.com/Azure/Azurite /opt/azurite && \
    git checkout legacy-master

RUN npm install

FROM node:10.14.2-alpine@sha256:46b2488c02dc82c801eaebc775019262e100af290dd06d61201a8dd53f78c022

COPY --from=builder /opt/azurite /opt/azurite

WORKDIR /opt/azurite

VOLUME /opt/azurite/folder

ENV executable azurite

CMD ["sh", "-c", "node bin/${executable} -l /opt/azurite/folder"]
