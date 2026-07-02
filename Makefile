CC      ?= cc
CFLAGS  ?= -O2 -Wall -Wextra -Wpedantic
LDFLAGS ?=

UNAME_S := $(shell uname -s)

ifeq ($(UNAME_S),Linux)
    LDFLAGS += -lutil -lpthread
endif

ifeq ($(UNAME_S),Darwin)
    # macOS has openpty in libc. pthreads are also built in.
    LDFLAGS += -lpthread
endif

ifeq ($(UNAME_S),FreeBSD)
    LDFLAGS += -lutil -lpthread
endif

ifeq ($(UNAME_S),OpenBSD)
    LDFLAGS += -lutil -lpthread
endif

ifeq ($(UNAME_S),NetBSD)
    LDFLAGS += -lutil -lpthread
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
