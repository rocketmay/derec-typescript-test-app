# DeRec + TypeScript

This repo is a simple Typescript React Vite app that utilizes the DeRec Library to generate, distribute and recover shares. It is NOT hardened for security and is intended to demonstrate functionality in a typescript environment.

## Installation

In addition to cloning this repo, you must also have a local clone of derecalliance/lib-derec : https://github.com/derecalliance/lib-derec

lib-derec automatically generates WASM bindings for typescript. We can import them as a dependency by changing the local path to where the library has been cloned to on your machine.

```js
      "dependencies": {
        "derec-lib": "file:../lib-derec/library/target/pkg-web"
```

## Runtime

Start the app with ```npm run dev```

### Open 4 browser tabs

Tab 1: Select Owner
Tab 2: Select Helper 1
Tab 3: Select Helper 2
Tab 4: Select Helper 3

### Test the workflow

In the Owner tab, click "Pair with Online Helpers"
Enter a secret and click "Protect Secret"
Watch the shares get distributed to each Helper tab
Click "Recover" to reconstruct the secret from the shares

### Features

Pairs with three helpers and allows sharing a secret with them
Verifies that helpers hold shares every 10s.
Successfully recovers secrets if enough helpers are available.

## To do:

Handle a helper forgetting a share - redistribute shares to maintain threshold.
Handle the Owner forgetting the secret
- Helpers should manually have to approve a recovery.
