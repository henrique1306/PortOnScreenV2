import serial
import requests
import cv2
import easyocr
import time
import re
import os
import base64

from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore

# ==========================================
# CONFIGURAÇÕES DO SISTEMA
# ==========================================
API_URL = os.getenv("API_URL", "https://api-arduino-khdv.onrender.com")
DATA_BACKEND = os.getenv("DATA_BACKEND", "api").lower()
FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "demo-portonscreen")
PORTA_SERIAL = os.getenv("PORTA_SERIAL", "COM6")
BAUD_RATE = int(os.getenv("BAUD_RATE", "9600"))
CAMERA_INDEX = int(os.getenv("CAMERA_INDEX", "2"))

if DATA_BACKEND not in {"api", "firebase"}:
    raise ValueError("DATA_BACKEND deve ser 'api' ou 'firebase'.")

if DATA_BACKEND == "firebase":
    firestore_db = firestore.Client(
        project=FIREBASE_PROJECT_ID,
        credentials=AnonymousCredentials()
    )
else:
    firestore_db = None

# Cria a pasta para salvar as fotos temporariamente
if not os.path.exists('fotos_acessos'):
    os.makedirs('fotos_acessos')

# ==========================================
# INICIALIZAÇÃO DOS DISPOSITIVOS E IA
# ==========================================
print("Carregando a Inteligência Artificial do EasyOCR... (Pode demorar alguns segundos na primeira vez)")
reader = easyocr.Reader(['en'], gpu=False)

try:
    arduino = serial.Serial(PORTA_SERIAL, BAUD_RATE, timeout=1)
    print(f"Conectado ao Arduino na porta {PORTA_SERIAL}")
except Exception as e:
    print(f"Erro ao conectar ao Arduino: {e}")
    exit()

cap = cv2.VideoCapture(CAMERA_INDEX)
if not cap.isOpened():
    print(f"Erro ao acessar a câmera no índice {CAMERA_INDEX}. Verifique a conexão USB.")
    exit()


# ==========================================
# FUNÇÕES PRINCIPAIS
# ==========================================
def ler_placa_da_imagem(frame):
    """Usa o EasyOCR para ler a placa diretamente da imagem"""
    print("Analisando a imagem com Inteligência Artificial...")

    resultados = reader.readtext(frame)
    placa_lida = ""
    maior_confianca = 0

    for (caixa, texto, confianca) in resultados:
        texto_limpo = re.sub(r'[^A-Z0-9]', '', texto.upper())
        if len(texto_limpo) >= 5 and confianca > maior_confianca:
            placa_lida = texto_limpo
            maior_confianca = confianca

    return placa_lida


def consultar_api_e_liberar(placa, frame):
    """Consulta o banco de dados, envia comando ao Arduino e salva TUDO no histórico"""
    print(f"Consultando a placa: {placa}...")

    # Valores padrão iniciais (caso o veículo não exista no banco)
    veiculo_autorizado = False
    nome_motorista = "Não Cadastrado"

    try:
        # GET: Verifica se a placa está registrada
        if DATA_BACKEND == "firebase":
            documento = firestore_db.collection("veiculos_autorizados").document(placa).get()
            veiculo_encontrado = documento.exists
            dados_veiculo = documento.to_dict() or {}
        else:
            resposta = requests.get(f"{API_URL}/veiculos_autorizados", params={"placa": placa})
            veiculo_encontrado = resposta.status_code == 200
            dados_veiculo = resposta.json() if veiculo_encontrado else {}

        if veiculo_encontrado:
            # Se achou no banco, pega o nome real dele independente de estar autorizado ou não
            nome_motorista = dados_veiculo.get('nome_condutor', 'Desconhecido')
            # Pega o valor real da autorização (True ou False)
            veiculo_autorizado = bool(dados_veiculo.get("autorizado"))

        # --- AÇÃO FÍSICA NO ARDUINO ---
        if veiculo_autorizado:
            print(f"Acesso Liberado para: {nome_motorista}")
            arduino.write(b"ABRIR_PORTAO\n")
        else:
            if veiculo_encontrado:
                print(f"Acesso NEGADO para usuário cadastrado (Bloqueado): {nome_motorista} (Placa: {placa})")
            else:
                print(f"Acesso NEGADO: Veículo não encontrado/não cadastrado. (Placa: {placa})")

            arduino.write(b"ACESSO_NEGADO\n")

        # --- REGISTRO NO HISTÓRICO ---
        nome_arquivo = f"fotos_acessos/acesso_{placa}_{int(time.time())}.webp"
        cv2.imwrite(nome_arquivo, frame, [cv2.IMWRITE_WEBP_QUALITY, 80])

        payload_historico = {
            "placa": placa,
            "nome_condutor": nome_motorista,
            "autorizado": veiculo_autorizado
        }

        if DATA_BACKEND == "firebase":
            firestore_db.collection("historico_acessos").add({
                **payload_historico,
                "foto_arquivo": nome_arquivo,
                "criado_em": firestore.SERVER_TIMESTAMP
            })
            print("Registro do evento salvo no Firebase local.")
        else:
            with open(nome_arquivo, "rb") as image_file:
                payload_historico["foto_base64"] = base64.b64encode(
                    image_file.read()
                ).decode("utf-8")

            requests.post(f"{API_URL}/historico_acessos", json=payload_historico)
            print("Registro do evento enviado para a nuvem.")

    except Exception as e:
        print(f"Falha ao consultar ou registrar o acesso: {e}")
        arduino.write(b"ACESSO_NEGADO\n")


# ==========================================
# LOOP PRINCIPAL (Aguardando o Arduino)
# ==========================================
print("\nSistema iniciado. Aguardando detecção do Arduino na câmera 1...")

while True:
    if arduino.in_waiting > 0:
        mensagem = arduino.readline().decode('utf-8').strip()

        if mensagem == "PROXIMIDADE_DETECTADA":
            print("\nVeículo detectado pelo sensor! Capturando imagem...")

            for _ in range(5): cap.grab()
            ret, frame = cap.read()

            if ret:
                placa_lida = ler_placa_da_imagem(frame)

                if len(placa_lida) >= 5:
                    print(f"EasyOCR leu: {placa_lida}")
                    consultar_api_e_liberar(placa_lida, frame)
                else:
                    print("Falha no OCR ou nenhuma placa válida detectada.")
                    arduino.write(b"ACESSO_NEGADO\n")
            else:
                print("Falha ao capturar imagem da câmera.")
                arduino.write(b"ACESSO_NEGADO\n")

    time.sleep(0.05)