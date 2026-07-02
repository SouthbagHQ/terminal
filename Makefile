CC      ?= cc
CFLAGS  ?= -O2 -Wall -Wextra -Wpedantic
LDFLAGS ?=

UNAME_S := $(shell uname -s)

ifeq ($(UNAME_S),Linux)
    LDFLAGS += -lutil
endif

ifeq ($(UNAME_S),Darwin)
    # macOS has openpty in libc. nothing to link.
endif

ifeq ($(UNAME_S),FreeBSD)
    LDFLAGS += -lutil
endif

ifeq ($(UNAME_S),OpenBSD)
    LDFLAGS += -lutil
endif

ifeq ($(UNAME_S),NetBSD)
    LDFLAGS += -lutil
endif

TARGET  = shitterm
SRC     = src/terminal.c

.PHONY: all clean install

all: $(TARGET)

$(TARGET): $(SRC)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)

clean:
	rm -f $(TARGET)

install: $(TARGET)
	install -Dm755 $(TARGET) $(DESTDIR)$(PREFIX)/bin/$(TARGET)
