# ai-torrent

Ce projet contient deux packages Node.js utilisant [libp2p](https://libp2p.io/) pour effectuer des requêtes d'inférence distribuées dans un réseau pair-à-pair classique. Les nœuds hébergent des fragments de modèle qui peuvent être dupliqués pour la résilience et le client répartit les requêtes entre plusieurs nœuds découverts en parallèle.

## Packages

- `client/` : programme CLI permettant de découvrir un noeud proposant un modèle d'IA via la DHT et d'envoyer une requête JSON sur le protocole `/ai-torrent/1/generate`.
- `node/` : démon qui annonce sa capacité dans la DHT, relaye les requêtes vers une instance locale d'Ollama et renvoie les réponses en NDJSON.

## Prérequis

- Node.js ≥ 20

## Fichier de configuration

Dupliquez `client/config.example.json` en `client/config.json` et renseignez **au moins** une adresse pour qu'au
moins un pair soit contacté lors de l'amorçage :

```json
{
  "bootstrapAddr": "/ip4/203.0.113.1/tcp/4001/p2p/QmBootstrapPeer",
  "nodes": [
    "/ip4/203.0.113.2/tcp/4001/p2p/QmAnotherPeer"
  ]
}
```

`bootstrapAddr` permet de joindre un nœud de bootstrap connu. À défaut, renseignez une liste de `nodes` connus. Sans
l'une de ces valeurs, la découverte via la DHT est indisponible et seuls les nœuds listés statiquement peuvent être
utilisés.

Ce fichier est lu automatiquement par le client pour éviter l'utilisation de variables d'environnement.

## Variables d'environnement

- `PORT` : port d'écoute du démon. Par défaut, le démon utilise le port configuré dans `node/config.yaml` (55781). Pour choisir un port stable, définissez cette variable avant de lancer le démon, par exemple : `PORT=60000 npm run start --prefix node`. Le client utilise également cette valeur pour se connecter au démon local lorsque `AI_TORRENT_ADDR` n'est pas fournie.
- `AI_TORRENT_ADDR` : adresse explicite du fournisseur. Ignorée si l'option `--discover` est utilisée.
## Démarrage rapide

```bash
# depuis la racine du repo
# installation des dépendances
npm install --prefix client
npm install --prefix node

# lancement du démon
npm run start --prefix node

# envoi d'une requête (découverte automatique)
npm run ask --prefix client -- --discover "Bonjour, qui es-tu ?"
```

Le démon doit avoir accès à une instance locale d'[Ollama](https://github.com/ollama/ollama) accessible sur `http://127.0.0.1:11434`.

L'option `--discover` force le client à ignorer `AI_TORRENT_ADDR` et à découvrir l'adresse du fournisseur via le fichier `daemon.addr` ou la DHT.
