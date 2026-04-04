#! /bin/bash

if test -d /content/; then
    CONTENT=/content
else
    CONTENT=$HOME
fi
cd $CONTENT
python -m venv venv
. venv/bin/activate
sudo apt update
sudo apt install git tesseract-ocr tesseract-ocr-ron poppler-utils -y
if ! test -d $CONTENT/pdfutils; then
    cd
    git clone https://github.com/Danielzapirtan/pdfutils
fi

cd $CONTENT/pdfutils/$APP
pip install -r requirements.txt
python3 app.py
