#! /bin/bash

sudo apt install git tesseract-ocr tesseract-ocr-ron poppler-utils
if ! test -d /content/pdfutils; then
    cd
    git clone https://github.com/Danielzapirtan/pdfutils
fi

cd /content/pdfutils
echo "Alegeti aplicatia"
echo "pdarg isplit ocr_pdf pdf_splitter"
read ans
cd /content/pdfutils/$ans
pip install -r requirements.txt
python3 app.py
