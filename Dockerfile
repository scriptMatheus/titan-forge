FROM node:20
#FROM node:11-alpine


RUN export DEBIAN_FRONTEND=noninteractive && apt-get update && apt-get install -y --force-yes \
    libreoffice \
    unzip \
    zip \
    && rm -rf /var/lib/apt/lists/* 

RUN mkdir -p /app 
WORKDIR /app
COPY package.json /app
COPY . /app
RUN npm install express
RUN npm install
ENV TZ=America/Sao_Paulo

# EXPOSE 3008
CMD ["npm", "start"]
