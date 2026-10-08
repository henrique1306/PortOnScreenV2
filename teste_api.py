import cv2
import easyocr
import re
import tkinter as tk
from tkinter import messagebox

# 1. Carrega a Inteligência Artificial (apenas inglês 'en' é ótimo para placas, pois não tem acentuação)
print("Carregando IA do EasyOCR... (Isso pode levar alguns segundos na primeira vez)")
reader = easyocr.Reader(['en'], gpu=False)  # gpu=False força a rodar no processador


def processar_ocr():
    cap = cv2.VideoCapture(0)
    ret, frame = cap.read()

    if ret:
        print("Analisando imagem com Inteligência Artificial...")

        # 2. Leitura Direta (sem precisar de filtros complexos do OpenCV)
        # O EasyOCR aceita a imagem colorida diretamente
        resultados = reader.readtext(frame)

        placa_lida = ""
        maior_confianca = 0

        # 3. Percorre tudo o que a IA leu na tela
        for (caixa_contorno, texto, confianca) in resultados:
            texto_limpo = re.sub(r'[^A-Z0-9]', '', texto.upper())

            # Pega o texto que pareça uma placa (ex: mais de 5 caracteres) e tenha boa confiança
            if len(texto_limpo) >= 5 and confianca > maior_confianca:
                placa_lida = texto_limpo
                maior_confianca = confianca

        if not placa_lida:
            messagebox.showwarning("Aviso", "Nenhuma placa identificada pela IA.")
        else:
            porcentagem = round(maior_confianca * 100, 1)
            messagebox.showinfo("Sucesso", f"Placa: {placa_lida}\nConfiança da IA: {porcentagem}%")

    cap.release()


# Interface
root = tk.Tk()
root.title("Teste EasyOCR")
root.geometry("300x150")

btn = tk.Button(root, text="Tirar Foto e Ler com EasyOCR", command=processar_ocr, height=3, bg="#2196F3", fg="white",
                font=("Arial", 10, "bold"))
btn.pack(pady=30)

root.mainloop()