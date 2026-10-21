CC ?= cc
CFLAGS ?= -O2 -std=c11 -Wall -Wextra -Werror -pedantic -D_DEFAULT_SOURCE
BUILD := build
CORE := core/dirgain.c core/dirgain.h

.PHONY: all test test-js test-c vectors linux bundle windows clean

all: test linux bundle

vectors:
	node core/gen-vectors.mjs

$(BUILD)/test_dirgain: core/test_dirgain.c $(CORE)
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -o $@ core/test_dirgain.c core/dirgain.c -lm

$(BUILD)/test_frame: linux/test_frame.c linux/frame.c linux/frame.h $(CORE)
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -Icore -o $@ linux/test_frame.c linux/frame.c core/dirgain.c -lm

$(BUILD)/dirgaind: linux/dirgaind.c linux/frame.c linux/frame.h $(CORE)
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -Icore -o $@ linux/dirgaind.c linux/frame.c core/dirgain.c -lm

test-js:
	node --test core/*.test.mjs web/*.test.mjs

test-c: $(BUILD)/test_dirgain $(BUILD)/test_frame vectors
	$(BUILD)/test_dirgain vectors/transform-vectors.txt
	$(BUILD)/test_frame

test: test-js test-c

linux: $(BUILD)/dirgaind

bundle:
	node tools/bundle.mjs

# make windows INTERCEPTION_SDK=/path/to/Interception  (cross-compiles with MinGW)
windows:
	@test -n "$(INTERCEPTION_SDK)" || (echo "set INTERCEPTION_SDK to a checkout of github.com/oblitum/Interception" && false)
	@mkdir -p $(BUILD)
	x86_64-w64-mingw32-gcc -O2 -std=c11 -Wall -Wextra -Icore -I$(INTERCEPTION_SDK)/library -DINTERCEPTION_STATIC \
		windows/dirgain-interception.c core/dirgain.c $(INTERCEPTION_SDK)/library/interception.c \
		-o $(BUILD)/dirgain-interception.exe

clean:
	rm -rf $(BUILD) dist
