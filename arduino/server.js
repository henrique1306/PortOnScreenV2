const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'trocar-por-um-segredo-forte-em-producao';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: false,
}));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de login. Tente novamente mais tarde.' }
});

const createUserLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas solicitações de cadastro. Tente novamente em uma hora.' }
});

let db = null;
let bucket = null;

if (process.env.FIREBASE_SERVICE_ACCOUNT && process.env.FIREBASE_STORAGE_BUCKET) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });

    db = admin.firestore();
    bucket = admin.storage().bucket();
    console.log('Firebase inicializado com sucesso.');
  } catch (erro) {
    console.error('Erro ao inicializar Firebase:', erro.message);
  }
} else {
  console.warn('Configuração do Firebase ausente. Defina FIREBASE_SERVICE_ACCOUNT e FIREBASE_STORAGE_BUCKET para usar Firestore e Storage.');
}

const validarSenha = (senha) => {
  if (typeof senha !== 'string') return false;
  if (senha.length < 12 || senha.length > 128) return false;
  if (senha.includes(' ')) return false;
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/.test(senha);
};

const removerSenha = (usuario) => {
  const { senhaHash, ...dadosSeguros } = usuario;
  return dadosSeguros;
};

const autenticar = async (req, res, next) => {
  if (!db) {
    return res.status(503).json({ erro: 'Serviço de banco indisponível.' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token de autenticação ausente.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const usuarioRef = await db.collection('usuarios').doc(payload.sub).get();

    if (!usuarioRef.exists) {
      return res.status(401).json({ erro: 'Usuário não encontrado.' });
    }

    const dadosUsuario = usuarioRef.data();
    if (dadosUsuario.status !== 'ativo') {
      return res.status(403).json({ erro: 'Usuário bloqueado ou inativo.' });
    }

    req.usuario = { id: usuarioRef.id, ...dadosUsuario };
    return next();
  } catch (erro) {
    console.error('Erro ao verificar token:', erro.message);
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }
};

const ENDPOINTS_PERMITIDOS = ['veiculos_autorizados', 'historico_acessos'];

const validarEndpoint = (req, res, next) => {
  const { endpoint } = req.params;
  if (!ENDPOINTS_PERMITIDOS.includes(endpoint)) {
    return res.status(404).json({ erro: `Endpoint '${endpoint}' inválido.` });
  }
  next();
};

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, firebase: Boolean(db) });
});

app.post('/usuarios', createUserLimiter, async (req, res) => {
  if (!db) {
    return res.status(503).json({ erro: 'Firebase não configurado. Verifique as variáveis de ambiente.' });
  }

  const { nome, email, senha } = req.body || {};

  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'Campos obrigatórios: nome, email e senha.' });
  }

  const nomeLimpo = String(nome).trim();
  const emailLimpo = String(email).trim().toLowerCase();

  if (nomeLimpo.length < 2 || nomeLimpo.length > 80) {
    return res.status(400).json({ erro: 'Nome deve ter entre 2 e 80 caracteres.' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpo)) {
    return res.status(400).json({ erro: 'Email inválido.' });
  }

  if (!validarSenha(senha)) {
    return res.status(400).json({
      erro: 'Senha fraca. Use 12+ caracteres, maiúscula, minúscula, número e caractere especial.',
    });
  }

  try {
    const usuariosExistentes = await db.collection('usuarios').where('email', '==', emailLimpo).limit(1).get();
    if (!usuariosExistentes.empty) {
      return res.status(409).json({ erro: 'Usuário já cadastrado com este email.' });
    }

    const senhaHash = await bcrypt.hash(senha, 12);
    const agora = new Date().toISOString();

    const usuario = {
      nome: nomeLimpo,
      email: emailLimpo,
      senhaHash,
      status: 'ativo',
      criadoEm: agora,
      atualizadoEm: agora,
      ultimoLogin: null,
      tentativasLogin: 0,
      bloqueadoAte: null,
    };

    const docRef = await db.collection('usuarios').add(usuario);
    const token = jwt.sign({ sub: docRef.id, email: emailLimpo, nome: nomeLimpo }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.status(201).json({
      mensagem: 'Usuário cadastrado com sucesso.',
      token,
      usuario: {
        id: docRef.id,
        nome: nomeLimpo,
        email: emailLimpo,
        status: 'ativo',
        criadoEm: agora,
      },
    });
  } catch (erro) {
    console.error('Erro ao criar usuário:', erro);
    return res.status(500).json({ erro: 'Falha ao cadastrar usuário.' });
  }
});

app.post('/usuarios/login', loginLimiter, async (req, res) => {
  if (!db) {
    return res.status(503).json({ erro: 'Firebase não configurado. Verifique as variáveis de ambiente.' });
  }

  const { email, senha } = req.body || {};

  if (!email || !senha) {
    return res.status(400).json({ erro: 'Email e senha são obrigatórios.' });
  }

  const emailLimpo = String(email).trim().toLowerCase();

  try {
    const snapshot = await db.collection('usuarios').where('email', '==', emailLimpo).limit(1).get();

    if (snapshot.empty) {
      return res.status(401).json({ erro: 'Credenciais inválidas.' });
    }

    const doc = snapshot.docs[0];
    const usuario = { id: doc.id, ...doc.data() };

    if (usuario.status !== 'ativo') {
      return res.status(403).json({ erro: 'Usuário bloqueado ou inativo.' });
    }

    const bloqueadoAte = usuario.bloqueadoAte ? new Date(usuario.bloqueadoAte) : null;
    if (bloqueadoAte && bloqueadoAte > new Date()) {
      return res.status(423).json({ erro: 'Conta temporariamente bloqueada por excesso de tentativas.' });
    }

    const senhaValida = await bcrypt.compare(String(senha), usuario.senhaHash || '');

    if (!senhaValida) {
      const tentativasLogin = (usuario.tentativasLogin || 0) + 1;
      const dadosAtualizados = {
        tentativasLogin,
        atualizadoEm: new Date().toISOString(),
      };

      if (tentativasLogin >= 5) {
        dadosAtualizados.status = 'bloqueado';
        dadosAtualizados.bloqueadoAte = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      }

      await db.collection('usuarios').doc(doc.id).update(dadosAtualizados);
      return res.status(401).json({ erro: 'Credenciais inválidas.' });
    }

    const dadosAtualizados = {
      ultimoLogin: new Date().toISOString(),
      tentativasLogin: 0,
      bloqueadoAte: null,
      atualizadoEm: new Date().toISOString(),
      status: 'ativo',
    };

    await db.collection('usuarios').doc(doc.id).update(dadosAtualizados);

    const token = jwt.sign({ sub: doc.id, email: emailLimpo, nome: usuario.nome }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.status(200).json({
      mensagem: 'Login realizado com sucesso.',
      token,
      usuario: {
        id: doc.id,
        nome: usuario.nome,
        email: emailLimpo,
        status: 'ativo',
        ultimoLogin: dadosAtualizados.ultimoLogin,
      },
    });
  } catch (erro) {
    console.error('Erro ao autenticar usuário:', erro);
    return res.status(500).json({ erro: 'Falha ao autenticar usuário.' });
  }
});

app.get('/usuarios', autenticar, async (req, res) => {
  try {
    const snapshot = await db.collection('usuarios').orderBy('criadoEm', 'desc').get();
    const usuarios = snapshot.docs.map((doc) => {
      const dados = doc.data();
      return {
        id: doc.id,
        nome: dados.nome,
        email: dados.email,
        status: dados.status,
        criadoEm: dados.criadoEm,
        ultimoLogin: dados.ultimoLogin,
      };
    });

    return res.status(200).json({ usuarios });
  } catch (erro) {
    console.error('Erro ao listar usuários:', erro);
    return res.status(500).json({ erro: 'Falha ao listar usuários.' });
  }
});

app.get('/usuarios/me', autenticar, async (req, res) => {
  const usuario = removerSenha(req.usuario);
  return res.status(200).json({ usuario });
});

app.get('/:endpoint', validarEndpoint, async (req, res) => {
  const { endpoint } = req.params;
  const { placa } = req.query;

  try {
    const colecaoRef = db.collection(endpoint);

    if (endpoint === 'veiculos_autorizados' && placa) {
      const snapshot = await colecaoRef.where('placa', '==', String(placa).toUpperCase().trim()).get();
      if (snapshot.empty) {
        return res.status(404).json({ autorizado: false, mensagem: 'Veículo não cadastrado.' });
      }

      let veiculo = {};
      snapshot.forEach(doc => { veiculo = { id_firebase: doc.id, ...doc.data() }; });
      return res.status(200).json(veiculo);
    }

    const snapshot = await colecaoRef.orderBy('dataHora', 'desc').limit(20).get();
    const registros = [];
    snapshot.forEach(doc => { registros.push({ id_firebase: doc.id, ...doc.data() }); });
    return res.status(200).json(registros);
  } catch (erro) {
    console.error(`Erro no GET /${endpoint}:`, erro);
    return res.status(500).json({ erro: 'Falha ao consultar o banco de dados.' });
  }
});

app.post('/:endpoint', validarEndpoint, async (req, res) => {
  const { endpoint } = req.params;
  const corpo = req.body;

  try {
    let dadosParaSalvar = { dataHora: new Date().toISOString() };

    if (endpoint === 'veiculos_autorizados') {
      if (!corpo.placa || !corpo.nome_condutor || corpo.autorizado === undefined) {
        return res.status(400).json({ erro: 'Campos obrigatórios: placa, nome_condutor, autorizado.' });
      }
      dadosParaSalvar.placa = String(corpo.placa).toUpperCase().trim();
      dadosParaSalvar.nome_condutor = String(corpo.nome_condutor).trim();
      dadosParaSalvar.autorizado = Boolean(corpo.autorizado);
    } else if (endpoint === 'historico_acessos') {
      if (!corpo.placa || corpo.autorizado === undefined || !corpo.foto_base64) {
        return res.status(400).json({ erro: 'Campos obrigatórios: placa, autorizado, foto_base64.' });
      }

      if (!bucket) {
        return res.status(503).json({ erro: 'Storage do Firebase não configurado.' });
      }

      const bufferImagem = Buffer.from(corpo.foto_base64, 'base64');
      const nomeArquivo = `fotos_acessos/${String(corpo.placa).toUpperCase().trim()}_${Date.now()}.webp`;
      const arquivoRef = bucket.file(nomeArquivo);

      await arquivoRef.save(bufferImagem, { metadata: { contentType: 'image/webp' } });
      const [urlPublica] = await arquivoRef.getSignedUrl({ action: 'read', expires: '01-01-2099' });

      dadosParaSalvar.placa = String(corpo.placa).toUpperCase().trim();
      dadosParaSalvar.nome_condutor = String(corpo.nome_condutor || 'Desconhecido').trim();
      dadosParaSalvar.autorizado = Boolean(corpo.autorizado);
      dadosParaSalvar.foto_url = urlPublica;
    }

    const docRef = await db.collection(endpoint).add(dadosParaSalvar);
    return res.status(201).json({ mensagem: 'Salvo com sucesso!', id_firebase: docRef.id });
  } catch (erro) {
    console.error(`Erro no POST /${endpoint}:`, erro);
    return res.status(500).json({ erro: 'Falha ao salvar dados.' });
  }
});

app.put('/:endpoint/:id', validarEndpoint, async (req, res) => {
  const { endpoint, id } = req.params;
  const corpo = req.body;

  try {
    let dadosAtualizar = {};
    if (endpoint === 'veiculos_autorizados') {
      if (corpo.placa) dadosAtualizar.placa = String(corpo.placa).toUpperCase().trim();
      if (corpo.nome_condutor) dadosAtualizar.nome_condutor = String(corpo.nome_condutor).trim();
      if (corpo.autorizado !== undefined) dadosAtualizar.autorizado = Boolean(corpo.autorizado);
    }
    await db.collection(endpoint).doc(id).update(dadosAtualizar);
    return res.status(200).json({ mensagem: 'Atualizado com sucesso!' });
  } catch (erro) {
    return res.status(500).json({ erro: 'Falha ao atualizar.' });
  }
});

app.delete('/:endpoint/:id', validarEndpoint, async (req, res) => {
  const { endpoint, id } = req.params;
  try {
    await db.collection(endpoint).doc(id).delete();
    return res.status(200).json({ mensagem: 'Excluído com sucesso!' });
  } catch (erro) {
    return res.status(500).json({ erro: 'Falha ao excluir.' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API rodando na porta ${PORT} em 0.0.0.0`);
});