FROM alpine:3.20

RUN apk add --no-cache python3 tzdata

COPY app /app

ENV DATA_DIR=/data PORT=8099 PYTHONUNBUFFERED=1 TZ=Europe/Vilnius

CMD ["python3", "/app/server.py"]
