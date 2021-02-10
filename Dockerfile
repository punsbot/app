FROM alpine:3.7
MAINTAINER soukron@gmbros.net

ENV TZ="Europe/Madrid"

RUN apk add --no-cache sqlite python py-pip nano
ADD app/requirements.txt /
RUN pip install -r /requirements.txt

ADD app/punsbot.py /
ADD app/defaultpuns /defaultpuns

CMD ["python", "-u", "/punsbot.py"]
