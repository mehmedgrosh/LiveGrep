# LiveGrep

Live grep web based application that allows the user to search directories for words and patters easily. It is using silversearch(ag), python FastAPI as a backend and js+html.

## Prerequisites
- python 3.13 and above
- sudo apt-get install silversearcher-ag  # use your distro's package manager
- pip install fastapi uvicorn python-multipart

## Run & use

- uvicorn main:app --reload
- open localhost:8000
- put the desired directory
- search for patterns/words
- see the results in real time

