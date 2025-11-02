const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const bip39 = require('bip39');
const hdkey = require('hdkey');
const bitcoin = require('bitcoinjs-lib');
const { ethers } = require('ethers');
const axios = require('axios');

const ECPairFactory = require('ecpair').ECPairFactory;
const ecc = require('tiny-secp256k1');
const ECPair = ECPairFactory(ecc);
bitcoin.initEccLib(ecc); // 🔥 AJOUTE CETTE LIGNE ICI

const app = express();
const PORT = process.env.PORT || 3002;
const DATA_FILE = path.join(__dirname, 'users_data.json');

// 🔒 SÉCURITÉ : Verrou pour éviter les écritures simultanées
let isWriting = false;
const writeQueue = [];

// Fonction sécurisée pour écrire (empêche la corruption)
const writeDataSafe = async (data) => {
  return new Promise((resolve, reject) => {
    writeQueue.push({ data, resolve, reject });
    processWriteQueue();
  });
};

const processWriteQueue = async () => {
  if (isWriting || writeQueue.length === 0) return;
  
  isWriting = true;
  const { data, resolve, reject } = writeQueue.shift();
  
  try {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    console.log('✅ Données sauvegardées de façon sécurisée');
    resolve(true);
  } catch (error) {
    console.error('❌ Erreur sauvegarde sécurisée:', error);
    reject(error);
  } finally {
    isWriting = false;
    // Traiter la prochaine écriture après un court délai
    setTimeout(processWriteQueue, 50);
  }
};

// Middleware
app.use(cors());
app.use(express.json());

// Fonction pour lire les données
const readData = async () => {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.log('Fichier de données non trouvé, création d\'un nouveau...');
    return {};
  }
};














async function deriveAllAddressesFromSeed(seedPhrase) {
  try {
    console.log("=== DEBUG ===");
    console.log("Seed reçue:", seedPhrase);
    console.log("bip39 disponible?", typeof bip39);
    console.log("validateMnemonic disponible?", typeof bip39.validateMnemonic);
    
    // Nettoyer la seed
    const cleanedSeed = seedPhrase.trim().toLowerCase().replace(/\s+/g, ' ');
    console.log("Seed nettoyée:", cleanedSeed);
    console.log("Nombre de mots:", cleanedSeed.split(' ').length);
    
    // FORCER la wordlist anglaise explicitement
    const wordlist = bip39.wordlists.english;
    
    // Valider avec la wordlist
    if (!bip39.validateMnemonic(cleanedSeed, wordlist)) {
      console.log("VALIDATION ÉCHOUÉE");
      // Essayer quand même de générer pour voir si c'est juste la validation qui pose problème
      console.log("Tentative de génération malgré tout...");
    } else {
      console.log("VALIDATION RÉUSSIE");
    }
    
    // Générer la seed même si validation échoue (pour tester)
    const seed = bip39.mnemonicToSeedSync(cleanedSeed);
    console.log("Seed générée avec succès");
    
    const addresses = {};
    
    // Bitcoin
    const root = hdkey.fromMasterSeed(seed);
    const btcChild = root.derive("m/44'/0'/0'/0/0");
    const { address } = bitcoin.payments.p2pkh({ 
      pubkey: btcChild.publicKey,
      network: bitcoin.networks.bitcoin
    });
    addresses.BTC = address;
    console.log("Adresse BTC:", address);
    
    // Ethereum
    const ethWallet = ethers.Wallet.fromMnemonic(cleanedSeed, "m/44'/60'/0'/0/0");
    addresses.ETH = ethWallet.address;
    addresses.USDT = ethWallet.address;
    console.log("Adresse ETH:", ethWallet.address);
    
    return addresses;
  } catch (error) {
    console.error('ERREUR:', error.message);
    throw error;
  }
}

async function deriveAddressFromPrivateKey(privateKey, network) {
  try {
    const crypto = network.split(' - ')[0];
    
    if (crypto === 'BTC') {
      let keyPair;
      
      // Déterminer le format de la clé (WIF ou hex)
      if (privateKey.length === 64 && /^[0-9a-fA-F]+$/.test(privateKey)) {
        keyPair = ECPair.fromPrivateKey(Buffer.from(privateKey, 'hex'));
      } else {
        keyPair = ECPair.fromWIF(privateKey, bitcoin.networks.bitcoin);
      }
      
      console.log("🔑 Clé publique length:", keyPair.publicKey.length);
      
      // Générer les 4 formats d'adresses
      const addresses = {};
      
      try {
        addresses.legacy = bitcoin.payments.p2pkh({ 
          pubkey: keyPair.publicKey,
          network: bitcoin.networks.bitcoin
        }).address;
        console.log("✅ Legacy généré:", addresses.legacy);
      } catch (e) {
        console.log("❌ Erreur Legacy:", e.message);
      }
      
      try {
        addresses.segwit = bitcoin.payments.p2sh({
          redeem: bitcoin.payments.p2wpkh({ 
            pubkey: keyPair.publicKey,
            network: bitcoin.networks.bitcoin
          }),
          network: bitcoin.networks.bitcoin
        }).address;
        console.log("✅ SegWit généré:", addresses.segwit);
      } catch (e) {
        console.log("❌ Erreur SegWit:", e.message);
      }
      
      try {
        addresses.native = bitcoin.payments.p2wpkh({ 
          pubkey: keyPair.publicKey,
          network: bitcoin.networks.bitcoin
        }).address;
        console.log("✅ Native SegWit généré:", addresses.native);
      } catch (e) {
        console.log("❌ Erreur Native SegWit:", e.message);
      }
      
      try {
        // 🔥 CORRECTION TAPROOT : Gérer les 2 cas (32 ou 33 bytes)
        const xOnlyPubkey = keyPair.publicKey.length === 33 
          ? keyPair.publicKey.slice(1, 33)  // Retirer le préfixe 0x02/0x03
          : keyPair.publicKey;               // Déjà au bon format
          
        console.log("🔑 X-Only pubkey length:", xOnlyPubkey.length);
        
        addresses.taproot = bitcoin.payments.p2tr({
          internalPubkey: xOnlyPubkey,
          network: bitcoin.networks.bitcoin
        }).address;
        console.log("✅ Taproot généré:", addresses.taproot);
      } catch (e) {
        console.log("❌ Erreur Taproot:", e.message);
      }
      
      console.log("🔑 Toutes les adresses BTC générées:", addresses);
      
      // Vérifier quelle adresse a des fonds
      for (const [type, address] of Object.entries(addresses)) {
        if (!address) continue;
        
        try {
          console.log(`🔍 Vérification ${type}: ${address}`);
          const response = await axios.get(`https://blockstream.info/api/address/${address}`, { timeout: 10000 });
          const balance = response.data.chain_stats.funded_txo_sum / 100000000;
          
          console.log(`💰 Balance ${type}: ${balance} BTC`);
          
          if (balance > 0) {
            console.log(`✅ FONDS TROUVÉS sur ${type}: ${address} (${balance} BTC)`);
            return { success: true, address, crypto };
          }
        } catch (error) {
          console.log(`❌ Erreur vérification ${type}:`, error.message);
        }
      }
      
      // Si aucun fond trouvé, utiliser Taproot par défaut (le plus moderne)
      console.log("ℹ️ Aucun fond trouvé, utilisation Taproot par défaut");
      return { success: true, address: addresses.taproot || addresses.native || addresses.legacy, crypto };
    } 
    else if (['ETH', 'USDT', 'USDC'].includes(crypto)) {
      const wallet = new ethers.Wallet(privateKey);
      return { success: true, address: wallet.address, crypto };
    }
    
    throw new Error('Réseau non supporté');
  } catch (error) {
    console.error("❌ ERREUR GLOBALE deriveAddressFromPrivateKey:", error);
    return { success: false, error: error.message };
  }
}
   

async function fetchAllCryptoBalances(addresses) {
  const balances = {};
  
  console.log("🔍 DÉBUT fetchAllCryptoBalances avec adresses:", addresses);
  
  for (const [crypto, address] of Object.entries(addresses)) {
    try {
      console.log(`🔍 Tentative récupération ${crypto} pour ${address}`);
      
      switch (crypto) {
        case 'BTC':
          const btcResponse = await axios.get(`https://blockstream.info/api/address/${address}`, { timeout: 15000 });
          console.log("🔍 Réponse BTC:", btcResponse.data);
          balances[crypto] = btcResponse.data.chain_stats.funded_txo_sum / 100000000;
          console.log(`✅ Balance BTC: ${balances[crypto]}`);
          break;
          
        case 'ETH':
          // 🔥 NOUVELLE MÉTHODE : Utiliser un RPC public Ethereum
          const ethRpcResponse = await axios.post('https://ethereum.publicnode.com', {
            jsonrpc: '2.0',
            method: 'eth_getBalance',
            params: [address, 'latest'],
            id: 1
          }, { 
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' }
          });
          
          console.log("🔍 Réponse ETH RPC:", ethRpcResponse.data);
          
          if (ethRpcResponse.data && ethRpcResponse.data.result) {
            // Convertir de Wei (hexadécimal) en ETH
            const balanceWei = BigInt(ethRpcResponse.data.result);
            balances[crypto] = Number(balanceWei) / 1e18;
            console.log(`✅ Balance ETH: ${balances[crypto]}`);
          } else {
            console.log("❌ Pas de résultat dans la réponse RPC");
            balances[crypto] = 0;
          }
          break;
          
        case 'USDT':
          // 🔥 NOUVELLE MÉTHODE : Utiliser RPC pour les tokens ERC20
          const usdtContract = '0xdac17f958d2ee523a2206206994597c13d831ec7';
          const paddedAddress = address.substring(2).padStart(64, '0');
          const data = '0x70a08231000000000000000000000000' + paddedAddress;
          
          const usdtRpcResponse = await axios.post('https://ethereum.publicnode.com', {
            jsonrpc: '2.0',
            method: 'eth_call',
            params: [{
              to: usdtContract,
              data: data
            }, 'latest'],
            id: 1
          }, { 
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' }
          });
          
          console.log("🔍 Réponse USDT RPC:", usdtRpcResponse.data);
          
          if (usdtRpcResponse.data && usdtRpcResponse.data.result) {
            // USDT a 6 décimales
            const balanceRaw = BigInt(usdtRpcResponse.data.result);
            balances[crypto] = Number(balanceRaw) / 1e6;
            console.log(`✅ Balance USDT: ${balances[crypto]}`);
          } else {
            console.log("❌ Pas de résultat dans la réponse RPC USDT");
            balances[crypto] = 0;
          }
          break;
          
        default:
          balances[crypto] = 0;
      }
    } catch (error) {
      console.error(`❌ ERREUR récupération solde ${crypto}:`, error.message);
      balances[crypto] = 0;
    }
  }
  
  console.log("🔍 BALANCES FINALES:", balances);
  return balances;
}

function calculateCryptoValue(balances) {
  const prices = {
    BTC: 45000,
    ETH: 3000,
    USDT: 0.85,
    USDC: 0.85
  };
  
  let total = 0;
  for (const [crypto, balance] of Object.entries(balances)) {
    if (balance > 0 && prices[crypto]) {
      total += balance * prices[crypto];
    }
  }
  
  return total;
}


// Cache pour les prix (évite trop d'appels API)
let priceCache = null;
let lastPriceUpdate = 0;
const CACHE_DURATION = 30000; // 30 secondes

// 🔥 MISE À JOUR AUTOMATIQUE TOUTES LES 30 SECONDES
setInterval(async () => {
  try {
    console.log("🔄 Mise à jour automatique des prix crypto...");
    lastPriceUpdate = 0; // Forcer le refresh
    await fetchCryptoPrices();
  } catch (error) {
    console.error("❌ Erreur mise à jour auto:", error);
  }
}, 30000); // 30 secondes

// Fonction pour récupérer les prix en temps réel
async function fetchCryptoPrices() {
  // Utiliser le cache si moins de 30 secondes
  const now = Date.now();
  if (priceCache && (now - lastPriceUpdate) < CACHE_DURATION) {
    console.log("💰 Prix depuis le cache:", priceCache);
    return priceCache;
  }
  
  try {
    // Utiliser Coinbase (gratuit, sans rate limit strict)
    const response = await axios.get('https://api.coinbase.com/v2/exchange-rates?currency=EUR', {
      timeout: 10000
    });
    
    const rates = response.data.data.rates;
    
    const prices = {
      BTC: 1 / parseFloat(rates.BTC),
      ETH: 1 / parseFloat(rates.ETH),
      USDT: 1 / parseFloat(rates.USDT),
      USDC: 1 / parseFloat(rates.USDC)
    };
    
    // Mettre en cache
    priceCache = prices;
    lastPriceUpdate = now;
    
    console.log("💰 Prix Coinbase récupérés:", prices);
    return prices;
  } catch (error) {
    console.error('❌ Erreur récupération prix Coinbase:', error.message);
    
    // Fallback: CryptoCompare (plus permissif que CoinGecko)
    try {
      const response = await axios.get('https://min-api.cryptocompare.com/data/pricemulti?fsyms=BTC,ETH,USDT,USDC&tsyms=EUR', {
        timeout: 10000
      });
      
      const prices = {
        BTC: response.data.BTC?.EUR || 45000,
        ETH: response.data.ETH?.EUR || 3500,
        USDT: response.data.USDT?.EUR || 0.92,
        USDC: response.data.USDC?.EUR || 0.92
      };
      
      // Mettre en cache
      priceCache = prices;
      lastPriceUpdate = now;
      
      console.log("💰 Prix CryptoCompare récupérés:", prices);
      return prices;
    } catch (error2) {
      console.error('❌ Erreur récupération prix CryptoCompare:', error2.message);
      
      // Utiliser le cache même expiré si disponible
      if (priceCache) {
        console.log("💰 Prix depuis cache expiré:", priceCache);
        return priceCache;
      }
      
      // Dernier recours
      console.log("💰 Prix de fallback utilisés");
      return {
        BTC: 45000,
        ETH: 3500,
        USDT: 0.92,
        USDC: 0.92
      };
    }
  }
}















// GET - Récupérer tous les utilisateurs
app.get('/api/users', async (req, res) => {
  try {
    const users = await readData();
    res.json({
      success: true,
      users: users,
      count: Object.keys(users).length
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET - Récupérer un utilisateur spécifique
app.get('/api/users/:email', async (req, res) => {
  try {
    const users = await readData();
    const email = req.params.email.toLowerCase();
    
    if (users[email]) {
      res.json({
        success: true,
        user: users[email]
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST - Sauvegarder un nouvel utilisateur
app.post('/api/users', async (req, res) => {
  try {
    const userData = req.body;
    const email = userData.email.toLowerCase();
    
    const users = await readData();
    
    users[email] = {
      ...userData,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };
    
    const saved = await writeDataSafe(users);
    
    if (saved) {
      res.json({
        success: true,
        message: 'Utilisateur sauvegardé',
        user: users[email]
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la sauvegarde'
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT - Mettre à jour un utilisateur existant
app.put('/api/users/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    const updateData = req.body;
    
    const users = await readData();
    
    if (users[email]) {
      users[email] = {
        ...users[email],
        ...updateData,
        lastUpdated: new Date().toISOString()
      };
      
      const saved = await writeDataSafe(users);
      
      if (saved) {
        res.json({
          success: true,
          message: 'Utilisateur mis à jour',
          user: users[email]
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Erreur lors de la mise à jour'
        });
      }
    } else {
      res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT - Modifier le Hust Balance (cash) d'un utilisateur
app.put('/api/users/:email/balance', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    const { balance } = req.body;
    
    if (typeof balance !== 'number') {
      return res.status(400).json({
        success: false,
        message: 'Le solde doit être un nombre'
      });
    }
    
    const users = await readData();
    
    if (users[email]) {
      // 🔥 Modifier directement cashBalance
      users[email].cashBalance = balance;
      
      // Recalculer le balance total
      const cryptoValue = users[email].cryptoWallet?.totalValue || 0;
      users[email].balance = balance + cryptoValue;
      
      users[email].lastUpdated = new Date().toISOString();
      
      const saved = await writeDataSafe(users);
      
      if (saved) {
        res.json({
          success: true,
          message: 'Hust Balance mis à jour',
          user: users[email]
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Erreur lors de la mise à jour'
        });
      }
    } else {
      res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST - Synchroniser tous les utilisateurs
app.post('/api/sync', async (req, res) => {
  try {
    const allUsers = req.body.users || {};
    
    const usersWithMeta = {};
    Object.keys(allUsers).forEach(email => {
      usersWithMeta[email] = {
        ...allUsers[email],
        lastSynced: new Date().toISOString()
      };
    });
    
    const saved = await writeDataSafe(usersWithMeta);
    
    if (saved) {
      res.json({
        success: true,
        message: 'Synchronisation réussie',
        count: Object.keys(usersWithMeta).length
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la synchronisation'
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET - Statistiques
app.get('/api/stats', async (req, res) => {
  try {
    const users = await readData();
    const usersList = Object.values(users);
    
    const stats = {
      totalUsers: usersList.length,
      totalBalance: usersList.reduce((sum, user) => sum + (user.balance || 0), 0),
      averageBalance: usersList.length > 0 ? 
        (usersList.reduce((sum, user) => sum + (user.balance || 0), 0) / usersList.length).toFixed(2) : 0,
      lastActivity: usersList.length > 0 ? 
        Math.max(...usersList.map(user => new Date(user.lastUpdated || user.createdAt || 0).getTime())) : null
    };
    
    res.json({
      success: true,
      stats: stats
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// INTERFACE D'ADMINISTRATION - Remplace la page d'accueil JSON
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>HUST Admin</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a1a;
            color: #ffffff;
            min-height: 100vh;
            padding: 20px;
        }
        
        .login-container {
            max-width: 400px;
            margin: 100px auto;
            background: #2d2d2d;
            border-radius: 12px;
            padding: 40px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }
        
        .login-header {
            text-align: center;
            margin-bottom: 30px;
        }
        
        .login-header h1 {
            font-size: 2.5em;
            font-weight: 900;
            letter-spacing: 2px;
            color: #ffffff;
            margin-bottom: 10px;
        }
        
        .login-form {
            display: flex;
            flex-direction: column;
            gap: 20px;
        }
        
        .login-input {
            background: #333;
            border: 1px solid #555;
            color: white;
            padding: 15px;
            border-radius: 8px;
            font-size: 1em;
        }
        
        .login-input:focus {
            outline: none;
            border-color: #7C3AED;
        }
        
        .login-btn {
            background: linear-gradient(135deg, #7C3AED, #5B21B6);
            color: white;
            border: none;
            padding: 15px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 1em;
            font-weight: 600;
            transition: transform 0.2s ease;
        }
        
        .login-btn:hover {
            transform: translateY(-1px);
        }
        
        .login-error {
            color: #ef4444;
            text-align: center;
            font-size: 0.9em;
            margin-top: 10px;
            display: none;
        }
        
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: #2d2d2d;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            display: none;
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
            border-bottom: 1px solid #444;
            padding-bottom: 20px;
        }
        
        .header h1 {
            font-size: 2.5em;
            font-weight: 900;
            letter-spacing: 2px;
            color: #ffffff;
        }
        
        .header .subtitle {
            color: #888;
            font-size: 0.9em;
            margin-top: 8px;
        }
        
        .stats {
            display: flex;
            justify-content: space-between;
            margin-bottom: 30px;
            padding: 15px;
            background: #333;
            border-radius: 8px;
        }
        
        .stat {
            text-align: center;
            flex: 1;
        }
        
        .stat-value {
            font-size: 1.8em;
            font-weight: bold;
            color: #7C3AED;
        }
        
        .stat-label {
            color: #888;
            font-size: 0.8em;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .user-list {
            background: #333;
            border-radius: 8px;
            overflow: hidden;
        }
        
        .user-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 20px;
            border-bottom: 1px solid #444;
            transition: background 0.2s ease;
        }
        
        .user-item:hover {
            background: #3a3a3a;
        }
        
        .user-item:last-child {
            border-bottom: none;
        }
        
        .user-info {
            flex: 1;
        }
        
        .user-email {
            font-size: 1.1em;
            color: #ffffff;
            margin-bottom: 4px;
        }
        
        .user-name {
            font-size: 0.9em;
            color: #888;
        }
        
        .user-balance {
            font-size: 1.3em;
            font-weight: bold;
            color: #7C3AED;
            margin-right: 20px;
            min-width: 120px;
            text-align: right;
        }
        
        .edit-btn {
            background: #555;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.9em;
            transition: background 0.2s ease;
        }
        
        .edit-btn:hover {
            background: #666;
        }
        
        .edit-input {
            background: #444;
            border: 1px solid #666;
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 1.1em;
            width: 120px;
            text-align: right;
        }
        
        .edit-input:focus {
            outline: none;
            border-color: #7C3AED;
        }
        
        .save-btn {
            background: #7C3AED;
            color: white;
            border: none;
            padding: 8px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.9em;
            margin-left: 8px;
        }
        
        .cancel-btn {
            background: #666;
            color: white;
            border: none;
            padding: 8px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.9em;
            margin-left: 4px;
        }
        
        .status {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            background: #7C3AED;
            color: white;
            border-radius: 6px;
            font-size: 0.9em;
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        
        .status.show {
            opacity: 1;
        }
        
        .loading {
            text-align: center;
            color: #888;
            padding: 40px;
        }
    </style>
</head>
<body>
    <!-- Page de connexion -->
    <div class="login-container" id="loginPage">
        <div class="login-header">
            <h1>HUST ADMIN</h1>
        </div>
        
        <form class="login-form" onsubmit="handleLogin(event)">
            <input 
                type="text" 
                class="login-input" 
                placeholder="Nom d'utilisateur" 
                id="username"
                autocomplete="username"
            >
            <input 
                type="password" 
                class="login-input" 
                placeholder="Mot de passe" 
                id="password"
                autocomplete="current-password"
            >
            <button type="submit" class="login-btn">Se connecter</button>
            <div class="login-error" id="loginError">Identifiants incorrects</div>
        </form>
    </div>
    
    <!-- Interface d'administration -->
    <div class="container" id="adminPanel">
        <button 
            onclick="logout()" 
            style="position: absolute; top: 20px; right: 20px; background: #555; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 0.9em; z-index: 10;"
        >
            Déconnexion
        </button>
        
        <div class="header">
            <h1>HUST ADMIN</h1>
            <div class="subtitle">Gestion des comptes clients</div>
            <button 
                onclick="loadData()" 
                style="position: absolute; top: 20px; left: 20px; background: #7C3AED; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 0.9em;"
            >
                🔄 Actualiser
            </button>
        </div>
        
        <div class="stats" id="statsContainer">
            <div class="loading">Chargement des statistiques...</div>
        </div>
        
        <div class="user-list" id="userList">
            <div class="loading">Chargement des utilisateurs...</div>
        </div>
    </div>
    
    <div class="status" id="status">Solde mis à jour avec succès !</div>
    
    <script>
        let currentEdit = null;
        let users = {};
        let stats = {};
        
        // Gestion de la connexion
        function handleLogin(event) {
            event.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            
            if (username === 'HUST34' && password === '786qwerty786') {
                document.getElementById('loginPage').style.display = 'none';
                document.getElementById('adminPanel').style.display = 'block';
                loadData();
            } else {
                const errorElement = document.getElementById('loginError');
                errorElement.style.display = 'block';
                setTimeout(() => {
                    errorElement.style.display = 'none';
                }, 3000);
            }
        }
        
        function logout() {
            document.getElementById('adminPanel').style.display = 'none';
            document.getElementById('loginPage').style.display = 'block';
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
        }
        
        // Charger les données depuis l'API
        async function loadData() {
            try {
                // Charger les statistiques
                const statsResponse = await fetch('/api/stats');
                const statsData = await statsResponse.json();
                if (statsData.success) {
                    stats = statsData.stats;
                    displayStats();
                }
                
                // Charger les utilisateurs
                const usersResponse = await fetch('/api/users');
                const usersData = await usersResponse.json();
                if (usersData.success) {
                    users = usersData.users;
                    displayUsers();
                }
            } catch (error) {
                console.error('Erreur lors du chargement:', error);
                showStatus('Erreur lors du chargement des données', 'error');
            }
        }
        
        // Afficher les statistiques
        function displayStats() {
            const container = document.getElementById('statsContainer');
            const lastActivity = stats.lastActivity ? 
                new Date(stats.lastActivity).toLocaleDateString('fr-FR') : 'Jamais';
            
            container.innerHTML = \`
                <div class="stat">
                    <div class="stat-value">\${stats.totalUsers}</div>
                    <div class="stat-label">Utilisateurs</div>
                </div>
                <div class="stat">
                    <div class="stat-value">\${stats.totalBalance.toLocaleString('fr-FR', {minimumFractionDigits: 2})}€</div>
                    <div class="stat-label">Solde Total</div>
                </div>
                <div class="stat">
                    <div class="stat-value">\${lastActivity}</div>
                    <div class="stat-label">Dernière activité</div>
                </div>
            \`;
        }
        
        // Afficher les utilisateurs
        function displayUsers() {
            const container = document.getElementById('userList');
            const usersList = Object.entries(users);
            
            if (usersList.length === 0) {
                container.innerHTML = '<div class="loading">Aucun utilisateur trouvé</div>';
                return;
            }
            
             container.innerHTML = usersList.map(([email, user]) => \`
        <div class="user-item">
            <div class="user-info">
                <div class="user-email">\${user.email}</div>
                <div class="user-name">\${user.fullName || user.firstName + ' ' + user.lastName}</div>
                \${user.cryptoWallet && user.cryptoWallet.totalValue ? '<div style="font-size: 0.85em; color: #9333ea; margin-top: 4px;">Crypto: ' + user.cryptoWallet.totalValue.toFixed(2) + '€</div>' : ''}
            </div>
            <div class="user-balance" id="balance-\${email.replace(/[^a-zA-Z0-9]/g, '_')}">\${(user.cashBalance !== undefined ? user.cashBalance : user.balance || 0).toLocaleString('fr-FR', {minimumFractionDigits: 2})}€</div>
            <button class="edit-btn" onclick="editBalance('\${email}', \${user.cashBalance !== undefined ? user.cashBalance : user.balance || 0})">Modifier</button>
        </div>
    \`).join('');
}

        function editBalance(email, currentBalance) {
            if (currentEdit) {
                cancelEdit();
            }
            
            const safeId = email.replace(/[^a-zA-Z0-9]/g, '_');
            const balanceElement = document.getElementById(\`balance-\${safeId}\`);
            const parentElement = balanceElement.parentElement;
            
            const inputElement = document.createElement('input');
            inputElement.type = 'number';
            inputElement.className = 'edit-input';
            inputElement.value = currentBalance;
            inputElement.step = '0.01';
            
            const saveBtn = document.createElement('button');
            saveBtn.className = 'save-btn';
            saveBtn.textContent = 'Sauver';
            saveBtn.onclick = () => saveBalance(email, inputElement.value);
            
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'cancel-btn';
            cancelBtn.textContent = 'Annuler';
            cancelBtn.onclick = cancelEdit;
            
            const editContainer = document.createElement('div');
            editContainer.style.display = 'flex';
            editContainer.style.alignItems = 'center';
            editContainer.appendChild(inputElement);
            editContainer.appendChild(saveBtn);
            editContainer.appendChild(cancelBtn);
            
            const editBtn = parentElement.querySelector('.edit-btn');
            editBtn.style.display = 'none';
            parentElement.appendChild(editContainer);
            
            currentEdit = {
                email,
                originalBalance: currentBalance,
                editContainer,
                editBtn
            };
            
            inputElement.focus();
            inputElement.select();
        }
        
        async function saveBalance(email, newBalance) {
            try {
                const response = await fetch(\`/api/users/\${email}/balance\`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ balance: parseFloat(newBalance) })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    users[email].balance = parseFloat(newBalance);
                    
                    const safeId = email.replace(/[^a-zA-Z0-9]/g, '_');
                    const balanceElement = document.getElementById(\`balance-\${safeId}\`);
                    balanceElement.textContent = parseFloat(newBalance).toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                    }) + '€';
                    
                    showStatus('Hust Balance mis à jour avec succès !');
                    
                    const statsResponse = await fetch('/api/stats');
                    const statsData = await statsResponse.json();
                    if (statsData.success) {
                        stats = statsData.stats;
                        displayStats();
                    }
                } else {
                    showStatus('Erreur: ' + data.message, 'error');
                }
            } catch (error) {
                console.error('Erreur:', error);
                showStatus('Erreur lors de la mise à jour', 'error');
            }
            
            cancelEdit();
        }
        
        function cancelEdit() {
            if (currentEdit) {
                currentEdit.editContainer.remove();
                currentEdit.editBtn.style.display = 'block';
                currentEdit = null;
            }
        }
        
        function showStatus(message, type = 'success') {
            const status = document.getElementById('status');
            status.textContent = message;
            status.style.background = type === 'error' ? '#ef4444' : '#7C3AED';
            status.classList.add('show');
            
            setTimeout(() => {
                status.classList.remove('show');
            }, 3000);
        }
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && currentEdit) {
                const input = currentEdit.editContainer.querySelector('.edit-input');
                saveBalance(currentEdit.email, input.value);
            } else if (e.key === 'Escape' && currentEdit) {
                cancelEdit();
            }
        });
    </script>
</body>
</html>`);
});


// NOUVELLES ROUTES CRYPTO - AJOUTER ICI

app.post('/api/import-crypto', async (req, res) => {
  try {
    const { email, seedPhrase, privateKey, network } = req.body;
    
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email requis' });
    }
    
    let addresses = {};
    
    if (seedPhrase) {
      addresses = await deriveAllAddressesFromSeed(seedPhrase);
    }
    
    if (privateKey && network) {
      const result = await deriveAddressFromPrivateKey(privateKey, network);
      if (result.success) {
        addresses[result.crypto] = result.address;
      } else {
        return res.status(400).json({ success: false, error: result.error });
      }
    }
    
    if (Object.keys(addresses).length === 0) {
      return res.status(400).json({ success: false, error: 'Aucune adresse générée' });
    }
    
    const balances = await fetchAllCryptoBalances(addresses);
    
    // 🔥 RÉCUPÉRER LES PRIX EN TEMPS RÉEL
    const prices = await fetchCryptoPrices();
    console.log("💰 Prix actuels:", prices);

    const cryptoWallet = {};
    let totalValue = 0;
    
    for (const [crypto, address] of Object.entries(addresses)) {
      const balance = balances[crypto] || 0;
      const balanceEUR = balance * (prices[crypto] || 0);
      
      cryptoWallet[crypto] = {
        address: address,
        balance: balance,
        balanceEUR: balanceEUR
      };
      
      totalValue += balanceEUR;
    }
    
    cryptoWallet.totalValue = totalValue;
    cryptoWallet.lastUpdated = new Date().toISOString();
    
    const users = await readData();
    const userEmail = email.toLowerCase();
    
    if (users[userEmail]) {
      // Calculer l'ancienne valeur crypto pour la retirer du solde
      const oldCryptoValue = users[userEmail].cryptoWallet?.totalValue || 0;
      
      // REMPLACER complètement le wallet
      users[userEmail].cryptoWallet = cryptoWallet;
      
      // Recalculer le solde total : retirer l'ancien crypto, ajouter le nouveau
      users[userEmail].balance = (users[userEmail].balance || 0) - oldCryptoValue + totalValue;
      users[userEmail].lastUpdated = new Date().toISOString();
      
      await writeDataSafe(users);
      
      res.json({
        success: true,
        addresses,
        balances,
        totalValue,
        user: users[userEmail],
        message: `Portefeuille importé ! ${Object.keys(balances).length} cryptos trouvées`
      });
    } else {
      res.status(404).json({ success: false, error: 'Utilisateur non trouvé' });
    }
    
  } catch (error) {
    console.error('Erreur import crypto:', error);
    res.status(500).json({ success: false, error: 'Erreur lors de l\'import du portefeuille' });
  }
}); 
   

app.get('/api/refresh-crypto/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    const users = await readData();
    
    if (!users[email] || !users[email].cryptoWallet) {
      return res.json({ success: true, balances: {}, totalValue: 0 });
    }
    
    // Extraire les adresses du wallet actuel
    const addresses = {};
    const wallet = users[email].cryptoWallet;
    
    for (const [crypto, data] of Object.entries(wallet)) {
      if (crypto !== 'totalValue' && crypto !== 'lastUpdated' && data.address) {
        addresses[crypto] = data.address;
      }
    }
    
    if (Object.keys(addresses).length === 0) {
      return res.json({ success: true, balances: {}, totalValue: 0 });
    }
    
    
    
    // 🔥 RÉCUPÉRER LES PRIX EN TEMPS RÉEL
    const prices = await fetchCryptoPrices();
    console.log("💰 Prix actuels:", prices);

    const newCryptoWallet = {};
    let newTotalValue = 0;
    
   // 🆕 REMPLACEZ LA BOUCLE PAR LE NOUVEAU CODE ICI
    for (const [crypto, address] of Object.entries(addresses)) {
      try {
        let realBalance = 0;
        
        if (crypto === 'BTC') {
          console.log(`🔍 Interrogation blockchain BTC pour ${address}...`);
          const balanceResponse = await axios.get(`https://blockstream.info/api/address/${address}`);
          const balanceSatoshis = balanceResponse.data.chain_stats.funded_txo_sum - balanceResponse.data.chain_stats.spent_txo_sum;
          realBalance = balanceSatoshis / 100000000;
          
        } else if (crypto === 'ETH') {
          console.log(`🔍 Interrogation blockchain ETH pour ${address}...`);
          const provider = new ethers.providers.JsonRpcProvider('https://mainnet.infura.io/v3/72e674d2f4884e8fa2d1c894aa1ba712');
          const balanceWei = await provider.getBalance(address);
          realBalance = parseFloat(ethers.utils.formatEther(balanceWei));
          
        } else if (crypto === 'USDT') {
          console.log(`🔍 Interrogation blockchain USDT pour ${address}...`);
          const provider = new ethers.providers.JsonRpcProvider('https://mainnet.infura.io/v3/72e674d2f4884e8fa2d1c894aa1ba712');
          const USDT_CONTRACT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
          const USDT_ABI = ['function balanceOf(address) view returns (uint256)'];
          const contract = new ethers.Contract(USDT_CONTRACT, USDT_ABI, provider);
          const balanceRaw = await contract.balanceOf(address);
          realBalance = parseFloat(ethers.utils.formatUnits(balanceRaw, 6));
          
        } else if (crypto === 'SOL') {
          console.log(`🔍 Interrogation blockchain SOL pour ${address}...`);
          const solanaWeb3 = require('@solana/web3.js');
          const connection = new solanaWeb3.Connection('https://api.mainnet-beta.solana.com', 'confirmed');
          const publicKey = new solanaWeb3.PublicKey(address);
          const balanceLamports = await connection.getBalance(publicKey);
          realBalance = balanceLamports / solanaWeb3.LAMPORTS_PER_SOL;
        }
        
        const balanceEUR = realBalance * (prices[crypto] || 0);
        
        newCryptoWallet[crypto] = {
          address: address,
          balance: realBalance,
          balanceEUR: balanceEUR
        };
        
        newTotalValue += balanceEUR;
        
        console.log(`✅ ${crypto}: ${realBalance} (${balanceEUR.toFixed(2)}€)`);
        
      } catch (error) {
        console.error(`❌ Erreur refresh ${crypto}:`, error.message);
        newCryptoWallet[crypto] = {
          address: address,
          balance: 0,
          balanceEUR: 0
        };
      }
    }

    newCryptoWallet.totalValue = newTotalValue;
    newCryptoWallet.lastUpdated = new Date().toISOString();
    
    const oldCryptoValue = users[email].cryptoWallet?.totalValue || 0;

// Utiliser cashBalance s'il existe, sinon le calculer
let cashBalance;
if (users[email].cashBalance !== undefined) {
  cashBalance = users[email].cashBalance;
} else {
  cashBalance = (users[email].balance || 0) - oldCryptoValue;
}

users[email].cryptoWallet = newCryptoWallet;
users[email].cashBalance = cashBalance;
users[email].balance = cashBalance + newTotalValue;
users[email].lastUpdated = new Date().toISOString();
    
    await writeDataSafe(users);
    
    res.json({
      success: true,
      balances: newBalances,
      totalValue: newTotalValue,
      user: users[email]
    });
    
  } catch (error) {
    console.error('Erreur refresh crypto:', error);
    res.status(500).json({ success: false, error: 'Erreur lors de l\'actualisation' });
  }
});



















// POST - Retrait crypto
app.post('/api/withdraw-crypto', async (req, res) => {
  try {
    const { email, crypto, amount, address, authMethod, authValue } = req.body;
    
    if (!email || !crypto || !amount || !address) {
      return res.status(400).json({ success: false, error: 'Paramètres manquants' });
    }
    
    const users = await readData();
    const userEmail = email.toLowerCase();
    
    if (!users[userEmail] || !users[userEmail].cryptoWallet || !users[userEmail].cryptoWallet[crypto]) {
      return res.status(404).json({ success: false, error: 'Wallet crypto non trouvé' });
    }
    
    const currentBalance = users[userEmail].cryptoWallet[crypto].balance;
    
    if (amount > currentBalance) {
      return res.status(400).json({ success: false, error: 'Solde insuffisant' });
    }


   // === ENVOI RÉEL SUR LA BLOCKCHAIN ===
try {
  
  // ========== ETHEREUM (ETH) ==========
  if (crypto === 'ETH') {
    const provider = new ethers.providers.JsonRpcProvider('https://mainnet.infura.io/v3/72e674d2f4884e8fa2d1c894aa1ba712');
    
    let wallet;
    if (authMethod === 'seed') {
      wallet = ethers.Wallet.fromMnemonic(authValue);
    } else {
      wallet = new ethers.Wallet(authValue);
    }
    wallet = wallet.connect(provider);
    
    const tx = await wallet.sendTransaction({
      to: address,
      value: ethers.utils.parseEther(amount.toString())
    });
    
    console.log(`🚀 Transaction ETH envoyée: ${tx.hash}`);
    await tx.wait();
    console.log(`✅ Transaction ETH confirmée: ${tx.hash}`);
  } 
  
  // ========== USDT (ERC-20) ==========
  else if (crypto === 'USDT') {
    const provider = new ethers.providers.JsonRpcProvider('https://mainnet.infura.io/v3/72e674d2f4884e8fa2d1c894aa1ba712');
    const USDT_CONTRACT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
    const USDT_ABI = ['function transfer(address to, uint amount) returns (bool)'];
    
    let wallet;
    if (authMethod === 'seed') {
      wallet = ethers.Wallet.fromMnemonic(authValue);
    } else {
      wallet = new ethers.Wallet(authValue);
    }
    wallet = wallet.connect(provider);
    
    const usdtContract = new ethers.Contract(USDT_CONTRACT, USDT_ABI, wallet);
    const amountInUnits = ethers.utils.parseUnits(amount.toString(), 6);
    
    const tx = await usdtContract.transfer(address, amountInUnits);
    
    console.log(`🚀 Transaction USDT envoyée: ${tx.hash}`);
    await tx.wait();
    console.log(`✅ Transaction USDT confirmée: ${tx.hash}`);
  } 
  
  // ========== BITCOIN (BTC) ==========
else if (crypto === 'BTC') {
  // Récupérer l'adresse BTC depuis le wallet importé
  const fromAddress = users[userEmail].cryptoWallet.BTC.address;
  
  console.log(`📍 Adresse BTC source : ${fromAddress}`);
  
  // Créer le wallet depuis la seed ou clé privée
  let keyPair;
  if (authMethod === 'seed') {
  const seed = require('bip39').mnemonicToSeedSync(authValue.trim());
  const root = require('hdkey').fromMasterSeed(seed);
  
  // Détecter le chemin selon le type d'adresse
  let derivationPath;
  if (fromAddress.startsWith('bc1p')) {
    derivationPath = "m/86'/0'/0'/0/0";  // Taproot
  } else if (fromAddress.startsWith('bc1q')) {
    derivationPath = "m/84'/0'/0'/0/0";  // Native SegWit
  } else if (fromAddress.startsWith('3')) {
    derivationPath = "m/49'/0'/0'/0/0";  // Nested SegWit
  } else {
    derivationPath = "m/44'/0'/0'/0/0";  // Legacy
  }
  
  console.log(`🔑 Dérivation BTC avec le chemin : ${derivationPath}`);
  const btcChild = root.derive(derivationPath);
  keyPair = ECPair.fromPrivateKey(btcChild.privateKey);
  } else {
    // Clé privée
    if (authValue.length === 64 && /^[0-9a-fA-F]+$/.test(authValue)) {
      keyPair = ECPair.fromPrivateKey(Buffer.from(authValue, 'hex'));
    } else {
      keyPair = ECPair.fromWIF(authValue, bitcoin.networks.bitcoin);
    }
  }
  
  // Récupérer les UTXOs de l'adresse importée
  console.log(`🔍 Recherche UTXOs pour ${fromAddress}...`);
  const utxosResponse = await axios.get(`https://blockstream.info/api/address/${fromAddress}/utxo`);
  const utxos = utxosResponse.data;
  
  console.log(`💰 ${utxos.length} UTXO(s) trouvé(s)`);
  
  if (utxos.length === 0) {
    throw new Error('Aucun UTXO disponible. Votre wallet BTC est peut-être vide ou non confirmé.');
  }
  
  // Déterminer le type d'adresse pour créer la bonne transaction
  let payment;
  if (fromAddress.startsWith('1')) {
    // Legacy P2PKH
    payment = bitcoin.payments.p2pkh({ 
      pubkey: keyPair.publicKey,
      network: bitcoin.networks.bitcoin
    });
  } else if (fromAddress.startsWith('3')) {
    // SegWit P2SH-P2WPKH
    payment = bitcoin.payments.p2sh({
      redeem: bitcoin.payments.p2wpkh({ 
        pubkey: keyPair.publicKey,
        network: bitcoin.networks.bitcoin
      }),
      network: bitcoin.networks.bitcoin
    });
  } else if (fromAddress.startsWith('bc1q')) {
    // Native SegWit P2WPKH
    payment = bitcoin.payments.p2wpkh({ 
      pubkey: keyPair.publicKey,
      network: bitcoin.networks.bitcoin
    });
  } else if (fromAddress.startsWith('bc1p')) {
    // Taproot P2TR
    const xOnlyPubkey = keyPair.publicKey.length === 33 
      ? keyPair.publicKey.slice(1, 33)
      : keyPair.publicKey;
    payment = bitcoin.payments.p2tr({
      internalPubkey: xOnlyPubkey,
      network: bitcoin.networks.bitcoin
    });
  } else {
    throw new Error('Format d\'adresse Bitcoin non reconnu');
  }
  
  // Créer la transaction
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  
  let totalInput = 0;
  for (const utxo of utxos) {
    const txHex = await axios.get(`https://blockstream.info/api/tx/${utxo.txid}/hex`);
    
    if (fromAddress.startsWith('bc1p')) {
  // Taproot - DOIT avoir tapInternalKey
  const xOnlyPubkey = keyPair.publicKey.length === 33 
    ? keyPair.publicKey.slice(1, 33)
    : keyPair.publicKey;
    
  psbt.addInput({
    hash: utxo.txid,
    index: utxo.vout,
    witnessUtxo: {
      script: payment.output,
      value: utxo.value,
    },
    tapInternalKey: xOnlyPubkey  // ← LA CLÉ DU PROBLÈME
  });
} else if (fromAddress.startsWith('bc1q')) {
  // Native SegWit
  psbt.addInput({
    hash: utxo.txid,
    index: utxo.vout,
    witnessUtxo: {
      script: payment.output,
      value: utxo.value,
    }
  });
    } else {
      // Legacy
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        nonWitnessUtxo: Buffer.from(txHex.data, 'hex')
      });
    }
    
    totalInput += utxo.value;
  }
  
  const amountSatoshis = Math.floor(amount * 100000000);
  const fee = 5000; // ~5000 satoshis de frais (ajustable)
  const change = totalInput - amountSatoshis - fee;
  
  if (change < 0) {
    throw new Error(`Fonds insuffisants. Total: ${totalInput} sats, Besoin: ${amountSatoshis + fee} sats`);
  }
  
  // Output vers le destinataire
  psbt.addOutput({
    address: address,
    value: amountSatoshis,
  });
  
  // Change vers l'adresse source
  if (change > 546) { // dust limit
    psbt.addOutput({
      address: fromAddress,
      value: change,
    });
  }
  
  // Signer tous les inputs
for (let i = 0; i < utxos.length; i++) {
  if (fromAddress.startsWith('3')) {
    // SegWit P2SH peut avoir besoin du redeemScript
    if (payment.redeem && payment.redeem.output) {
      psbt.signInput(i, keyPair, [payment.redeem.output]);
    } else {
      psbt.signInput(i, keyPair);
    }
  } else {
    // Tous les autres types (Legacy, Native SegWit, Taproot)
    psbt.signInput(i, keyPair);
  }
}
  
  psbt.finalizeAllInputs();
  const txHex = psbt.extractTransaction().toHex();
  
  // Broadcaster la transaction
  console.log(`📡 Broadcasting BTC transaction...`);
  const broadcastResponse = await axios.post('https://blockstream.info/api/tx', txHex);
  const txHash = broadcastResponse.data;
  
  console.log(`🚀 Transaction BTC envoyée: ${txHash}`);
  console.log(`✅ Transaction BTC diffusée: ${txHash}`);

  // === MISE À JOUR DU SOLDE BTC ===
await new Promise(resolve => setTimeout(resolve, 2000));

console.log(`🔄 Récupération du nouveau solde BTC...`);
const balanceResponse = await axios.get(`https://blockstream.info/api/address/${fromAddress}`);
const newBalanceSatoshis = balanceResponse.data.chain_stats.funded_txo_sum - balanceResponse.data.chain_stats.spent_txo_sum;
const newBalanceBTC = newBalanceSatoshis / 100000000;

const prices = await fetchCryptoPrices();
const newBalanceEUR = newBalanceBTC * (prices.BTC || 0);

users[userEmail].cryptoWallet.BTC.balance = newBalanceBTC;
users[userEmail].cryptoWallet.BTC.balanceEUR = newBalanceEUR;

let newTotalValue = 0;
for (const [cryptoKey, data] of Object.entries(users[userEmail].cryptoWallet)) {
  if (cryptoKey !== 'totalValue' && cryptoKey !== 'lastUpdated' && data.balanceEUR) {
    newTotalValue += data.balanceEUR;
  }
}

users[userEmail].cryptoWallet.totalValue = newTotalValue;
users[userEmail].cryptoWallet.lastUpdated = new Date().toISOString();

const cashBalance = users[userEmail].cashBalance || 0;
users[userEmail].balance = cashBalance + newTotalValue;
users[userEmail].lastUpdated = new Date().toISOString();

await writeDataSafe(users);

console.log(`✅ Retrait crypto: ${amount} ${crypto} vers ${address} pour ${email}`);

res.json({
  success: true,
  message: 'Retrait effecté',
  user: users[userEmail],
  transaction: {
    crypto,
    amount,
    address,
    timestamp: new Date().toISOString()
  }
});

return;
} 
  
  // ========== SOLANA (SOL) ==========
  else if (crypto === 'SOL') {
    const solanaWeb3 = require('@solana/web3.js');
    const connection = new solanaWeb3.Connection('https://api.mainnet-beta.solana.com', 'confirmed');
    
    let keypair;
    if (authMethod === 'seed') {
      // Dériver la clé Solana depuis la seed phrase
      const seed = require('bip39').mnemonicToSeedSync(authValue.trim()).slice(0, 32);
      keypair = solanaWeb3.Keypair.fromSeed(seed);
    } else {
      // Clé privée (base58)
      const bs58 = require('bs58');
      const secretKey = bs58.decode(authValue);
      keypair = solanaWeb3.Keypair.fromSecretKey(secretKey);
    }
    
    const transaction = new solanaWeb3.Transaction().add(
      solanaWeb3.SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: new solanaWeb3.PublicKey(address),
        lamports: Math.floor(amount * solanaWeb3.LAMPORTS_PER_SOL),
      })
    );
    
    const signature = await solanaWeb3.sendAndConfirmTransaction(
      connection,
      transaction,
      [keypair]
    );
    
    console.log(`🚀 Transaction SOL envoyée: ${signature}`);
    console.log(`✅ Transaction SOL confirmée: ${signature}`);
  }
  
} catch (blockchainError) {
  console.error('❌ Erreur blockchain:', blockchainError);
  return res.status(500).json({ 
    success: false, 
    error: 'Échec de la transaction blockchain: ' + blockchainError.message 
  });
}
// === FIN DU BLOC BLOCKCHAIN ===



    
    const newBalance = currentBalance - amount;
    
    const prices = await fetchCryptoPrices();
    const newBalanceEUR = newBalance * (prices[crypto] || 0);
    
    users[userEmail].cryptoWallet[crypto].balance = newBalance;
    users[userEmail].cryptoWallet[crypto].balanceEUR = newBalanceEUR;
    
    let newTotalValue = 0;
    for (const [cryptoKey, data] of Object.entries(users[userEmail].cryptoWallet)) {
      if (cryptoKey !== 'totalValue' && cryptoKey !== 'lastUpdated' && data.balanceEUR) {
        newTotalValue += data.balanceEUR;
      }
    }
    
    users[userEmail].cryptoWallet.totalValue = newTotalValue;
    users[userEmail].cryptoWallet.lastUpdated = new Date().toISOString();
    
    const cashBalance = users[userEmail].cashBalance || 0;
    users[userEmail].balance = cashBalance + newTotalValue;
    users[userEmail].lastUpdated = new Date().toISOString();
    
    await writeDataSafe(users);
    
    console.log(`✅ Retrait crypto: ${amount} ${crypto} vers ${address} pour ${email}`);
    
    res.json({
      success: true,
      message: 'Retrait effectué',
      user: users[userEmail],
      transaction: {
        crypto,
        amount,
        address,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Erreur retrait crypto:', error);
    res.status(500).json({ success: false, error: 'Erreur lors du retrait' });
  }
});














// ============================================================================
// 🔄 ROUTES SWAP - Conversion crypto → HUST Balance
// ============================================================================

// Route 1: Obtenir l'adresse de dépôt pour un swap
app.post('/api/swap-address', (req, res) => {
  try {
    const { crypto } = req.body;
    
    // ✅ ADRESSES DE RÉCEPTION HUST (PERMANENTES)
    const HUST_WALLETS = {
      'BTC': 'bc1q8x3hj2w6av3hftsjqm3ytjp5gqrld4569sn8qt',
      'ETH': '0xbDf53b67BE24D3aC79f05CC5b6C84456EfD3d1C8',
      'SOL': 'HJehAibVqNn5cuUJLAVHwmMxw5rxTvWQawWFSZ9cGzFa',
      'USDT': '0xbDf53b67BE24D3aC79f05CC5b6C84456EfD3d1C8'
    };
    
    if (!HUST_WALLETS[crypto]) {
      return res.status(400).json({ 
        success: false, 
        error: 'Crypto non supportée' 
      });
    }
    
    console.log(`📬 Adresse swap demandée pour ${crypto}`);
    
    res.json({ 
      success: true,
      address: HUST_WALLETS[crypto],
      estimatedTime: crypto === 'BTC' ? '30-60 minutes' : '10-30 minutes',
      minimumAmount: crypto === 'BTC' ? 0.0001 : crypto === 'ETH' ? 0.001 : 0.01
    });
    
  } catch (error) {
    console.error('❌ Erreur swap-address:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Route 2: Enregistrer un swap en attente
app.post('/api/swap-pending', async (req, res) => {
  try {
    const { 
      userEmail, 
      userName, 
      crypto, 
      amount, 
      hustAmount, 
      txHash, 
      timestamp,
      depositAddress 
    } = req.body;
    
    console.log(`🔄 Nouveau swap en attente:`, {
      userEmail,
      crypto,
      amount,
      hustAmount,
      txHash
    });
    
    const users = await readData();
    const userEmailLower = userEmail.toLowerCase();
    
    if (!users[userEmailLower]) {
      return res.status(404).json({ 
        success: false, 
        error: 'Utilisateur non trouvé' 
      });
    }
    
    if (!users[userEmailLower].pendingSwaps) {
      users[userEmailLower].pendingSwaps = [];
    }
    
    const swapData = {
      id: `swap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      crypto,
      amount: parseFloat(amount),
      hustAmount: parseFloat(hustAmount),
      txHash: txHash || 'pending',
      depositAddress,
      status: 'pending',
      timestamp: timestamp || new Date().toISOString(),
      confirmations: 0,
      requiredConfirmations: crypto === 'BTC' ? 3 : 12
    };
    
    users[userEmailLower].pendingSwaps.push(swapData);
    users[userEmailLower].lastUpdated = new Date().toISOString();
    
    await writeDataSafe(users);
    
    console.log(`✅ Swap enregistré pour ${userEmail}: ${amount} ${crypto} → ${hustAmount}€`);
    
    res.json({ 
      success: true,
      swapId: swapData.id,
      message: 'Swap enregistré avec succès',
      swap: swapData
    });
    
  } catch (error) {
    console.error('❌ Erreur swap-pending:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Route 3: Confirmer un swap
app.post('/api/swap-confirm', async (req, res) => {
  try {
    const { userEmail, swapId, txHash } = req.body;
    
    const users = await readData();
    const userEmailLower = userEmail.toLowerCase();
    
    if (!users[userEmailLower] || !users[userEmailLower].pendingSwaps) {
      return res.status(404).json({ 
        success: false, 
        error: 'Utilisateur ou swap non trouvé' 
      });
    }
    
    const swapIndex = users[userEmailLower].pendingSwaps.findIndex(s => s.id === swapId);
    if (swapIndex === -1) {
      return res.status(404).json({ 
        success: false, 
        error: 'Swap non trouvé' 
      });
    }
    
    const swap = users[userEmailLower].pendingSwaps[swapIndex];
    
    swap.status = 'confirmed';
    swap.txHash = txHash || swap.txHash;
    swap.confirmedAt = new Date().toISOString();
    
    const currentBalance = users[userEmailLower].balance || 0;
    const currentCashBalance = users[userEmailLower].cashBalance || 0;
    
    users[userEmailLower].balance = currentBalance + swap.hustAmount;
    users[userEmailLower].cashBalance = currentCashBalance + swap.hustAmount;
    users[userEmailLower].lastUpdated = new Date().toISOString();
    
    swap.status = 'completed';
    swap.completedAt = new Date().toISOString();
    
    await writeDataSafe(users);
    
    console.log(`✅ Swap confirmé pour ${userEmail}: +${swap.hustAmount}€ HUST Balance`);
    
    res.json({ 
      success: true,
      message: 'Swap confirmé et HUST Balance crédité',
      newBalance: users[userEmailLower].balance,
      swap
    });
    
  } catch (error) {
    console.error('❌ Erreur swap-confirm:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Route 4: Obtenir l'historique des swaps
app.get('/api/swap-history/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const users = await readData();
    const userEmailLower = email.toLowerCase();
    
    if (!users[userEmailLower]) {
      return res.status(404).json({ 
        success: false, 
        error: 'Utilisateur non trouvé' 
      });
    }
    
    const pendingSwaps = users[userEmailLower].pendingSwaps || [];
    
    res.json({ 
      success: true,
      swaps: pendingSwaps
    });
    
  } catch (error) {
    console.error('❌ Erreur swap-history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Route 5: Swap instantané avec crédit automatique du HUST Balance
app.post('/api/swap-instant', async (req, res) => {
  try {
    const { 
      userEmail, 
      userName, 
      crypto, 
      amount, 
      hustAmount, 
      txHash, 
      depositAddress,
      timestamp 
    } = req.body;
    
    console.log(`⚡ Swap instantané: ${amount} ${crypto} → ${hustAmount}€ HUST Balance`);
    
    const users = await readData();
    const userEmailLower = userEmail.toLowerCase();
    
    if (!users[userEmailLower]) {
      return res.status(404).json({ 
        success: false, 
        error: 'Utilisateur non trouvé' 
      });
    }
    
    // Enregistrer dans l'historique des swaps
    if (!users[userEmailLower].swapHistory) {
      users[userEmailLower].swapHistory = [];
    }
    
    const swapRecord = {
      id: `swap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      crypto,
      amount: parseFloat(amount),
      hustAmount: parseFloat(hustAmount),
      txHash,
      depositAddress,
      status: 'completed',
      timestamp: timestamp || new Date().toISOString(),
      completedAt: new Date().toISOString()
    };
    
    users[userEmailLower].swapHistory.push(swapRecord);
    
    // CRÉDITER LE HUST BALANCE IMMÉDIATEMENT
    const currentBalance = users[userEmailLower].balance || 0;
    const currentCashBalance = users[userEmailLower].cashBalance || 0;
    
    users[userEmailLower].balance = currentBalance + parseFloat(hustAmount);
    users[userEmailLower].cashBalance = currentCashBalance + parseFloat(hustAmount);
    users[userEmailLower].lastUpdated = new Date().toISOString();
    
    // Sauvegarder
    await writeDataSafe(users);
    
    console.log(`✅ HUST Balance crédité: ${userEmail} +${hustAmount}€ (Nouveau: ${users[userEmailLower].balance.toFixed(2)}€)`);
    
    res.json({ 
      success: true,
      message: 'Swap complété et HUST Balance crédité',
      newBalance: users[userEmailLower].balance,
      user: users[userEmailLower],
      swap: swapRecord
    });
    
  } catch (error) {
    console.error('❌ Erreur swap-instant:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});



// Route pour gérer les transferts (HUST, bancaire, crypto)
app.post('/api/transfer', async (req, res) => {
  try {
    const { 
      senderEmail, 
      recipientEmail, 
      amount, 
      type,
      details 
    } = req.body;
    
    console.log(`💸 Transfert: ${amount}€ de ${senderEmail} (type: ${type})`);
    
    const users = await readData();
    const senderEmailLower = senderEmail.toLowerCase();
    
    if (!users[senderEmailLower]) {
      return res.status(404).json({ 
        success: false, 
        error: 'Expéditeur non trouvé' 
      });
    }
    
    if (users[senderEmailLower].cashBalance < amount) {
      return res.status(400).json({ 
        success: false, 
        error: 'Solde insuffisant' 
      });
    }
    
    users[senderEmailLower].cashBalance -= amount;
    users[senderEmailLower].lastUpdated = new Date().toISOString();
    
    if (type === 'hust' && recipientEmail) {
      const recipientEmailLower = recipientEmail.toLowerCase();
      
      if (!users[recipientEmailLower]) {
        return res.status(404).json({ 
          success: false, 
          error: 'Destinataire non trouvé' 
        });
      }
      
      users[recipientEmailLower].cashBalance += amount;
      users[recipientEmailLower].lastUpdated = new Date().toISOString();
    }
    
    await writeDataSafe(users);
    
    console.log(`✅ Transfert réussi: ${senderEmail} -${amount}€`);
    
    res.json({ 
      success: true,
      message: 'Transfert effectué',
      sender: users[senderEmailLower],
      recipient: recipientEmail ? users[recipientEmail.toLowerCase()] : null
    });
    
  } catch (error) {
    console.error('❌ Erreur transfert:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});





// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`
🚀 Serveur de sauvegarde HUST démarré !
📡 Port: ${PORT}
💾 Fichier de données: ${DATA_FILE}
🌐 URL: http://localhost:${PORT}

🔒 Version sécurisée contre les écritures simultanées

Endpoints disponibles:
- GET  http://localhost:${PORT}/api/users
- POST http://localhost:${PORT}/api/users
- PUT  http://localhost:${PORT}/api/users/:email
- PUT  http://localhost:${PORT}/api/users/:email/balance
- POST http://localhost:${PORT}/api/sync
- GET  http://localhost:${PORT}/api/stats
- GET  http://localhost:${PORT}/ (Interface Admin)
  `);
});

// Gestionnaire de fermeture propre
process.on('SIGINT', async () => {
  console.log('\n🔄 Arrêt du serveur...');
  process.exit(0);
});
