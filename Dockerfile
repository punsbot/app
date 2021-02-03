FROM alpine:3.7
MAINTAINER soukron@gmbros.net

ENV TZ="Europe/Madrid"

ADD app/punsbot.py /
ADD app/defaultpuns /defaultpuns

CMD ["python", "-u", "/punsbot.py"]
