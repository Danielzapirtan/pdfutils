#! /bin/bash

if test -d /content/; then
    CONTENT=/content
else
    CONTENT=$HOME
fi
sudo apt install git tesseract-ocr tesseract-ocr-ron poppler-utils
if ! test -d $CONTENT/pdfutils; then
    cd
    git clone https://github.com/Danielzapirtan/pdfutils
fi

cd $CONTENT/pdfutils
echo "Alegeti aplicatia"
echo "pdarg isplit ocr_pdf pdf_splitter"
read ans
cd $CONTENT/pdfutils/$ans
pip install -r requirements.txt
python3 app.py
