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

Le démon doit avoir accès à une instance locale d'[Ollama](https://github.com/ollama/ollama) accessible sur `http://127.0.0.1:11434`.
