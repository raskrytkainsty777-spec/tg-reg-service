FROM andrius/asterisk:latest

COPY templates /opt/asterisk/templates
COPY docker-entrypoint.sh /usr/local/bin/asterisk-entrypoint

RUN chmod +x /usr/local/bin/asterisk-entrypoint

ENTRYPOINT ["/bin/sh", "/usr/local/bin/asterisk-entrypoint"]
CMD ["/usr/sbin/asterisk", "-vvvdddf", "-T", "-W", "-U", "asterisk", "-p"]
