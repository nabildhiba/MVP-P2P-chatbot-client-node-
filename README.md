# ai-torrent

Ce projet contient deux packages Node.js utilisant [libp2p](https://libp2p.io/) pour effectuer des requêtes d'inférence distribuées.

## Packages

- `client/` : programme CLI permettant de découvrir un noeud proposant un modèle d'IA via la DHT et d'envoyer une requête JSON sur le protocole `/ai-torrent/1/generate`.
- `node/` : démon qui annonce sa capacité dans la DHT, relaye les requêtes vers une instance locale d'Ollama et renvoie les réponses en NDJSON.

## Prérequis

- Node.js ≥ 20

## Démarrage rapide

```bash
# depuis la racine du repo
# installation des dépendances
npm install --prefix client
npm install --prefix node

# lancement du démon
npm run start --prefix node

# envoi d'une requête
npm run ask --prefix client -- "Bonjour, qui es-tu ?"
```

## Configuration réseau

Avant d'interroger le démon, le client doit rejoindre la même DHT qu'un pair connu.
Indiquez l'adresse multiaddr du démon via la variable d'environnement `AI_TORRENT_ADDR` :

```bash
export AI_TORRENT_ADDR=/ip4/127.0.0.1/tcp/4513/ws
```

À défaut, le client tentera de contacter une adresse de bootstrap par défaut.
Les paquets `client` et `node` utilisent aussi mDNS pour découvrir automatiquement les pairs locaux.

Le démon doit avoir accès à une instance locale d'[Ollama](https://github.com/ollama/ollama) accessible sur `http://127.0.0.1:11434`.
