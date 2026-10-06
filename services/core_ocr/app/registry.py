from .common import ApiError


class HandlerRegistry:
    def __init__(self):
        self._handlers = {}

    def register(self, name, handler):
        if name in self._handlers:
            raise ValueError(f"Duplicate handler: {name}")
        self._handlers[name] = handler

    def get(self, name):
        if name not in self._handlers:
            raise ApiError("Loại tài liệu chưa được hỗ trợ")
        return self._handlers[name]
