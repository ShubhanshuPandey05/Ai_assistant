# -*- coding: utf-8 -*-
# Generated by the protocol buffer compiler.  DO NOT EDIT!
# NO CHECKED-IN PROTOBUF GENCODE
# source: turn.proto
# Protobuf Python Version: 6.31.0
"""Generated protocol buffer code."""
from google.protobuf import descriptor as _descriptor
from google.protobuf import descriptor_pool as _descriptor_pool
from google.protobuf import runtime_version as _runtime_version
from google.protobuf import symbol_database as _symbol_database
from google.protobuf.internal import builder as _builder
_runtime_version.ValidateProtobufRuntimeVersion(
    _runtime_version.Domain.PUBLIC,
    6,
    31,
    0,
    '',
    'turn.proto'
)
# @@protoc_insertion_point(imports)

_sym_db = _symbol_database.Default()




DESCRIPTOR = _descriptor_pool.Default().AddSerializedFile(b'\n\nturn.proto\x12\x04turn\",\n\x0b\x43hatMessage\x12\x0c\n\x04role\x18\x01 \x01(\t\x12\x0f\n\x07\x63ontent\x18\x02 \x01(\t\"2\n\x0b\x43hatHistory\x12#\n\x08messages\x18\x01 \x03(\x0b\x32\x11.turn.ChatMessage\"#\n\x0cTurnResponse\x12\x13\n\x0b\x65nd_of_turn\x18\x01 \x01(\x08\x32G\n\x0cTurnDetector\x12\x37\n\x0e\x43heckEndOfTurn\x12\x11.turn.ChatHistory\x1a\x12.turn.TurnResponseb\x06proto3')

_globals = globals()
_builder.BuildMessageAndEnumDescriptors(DESCRIPTOR, _globals)
_builder.BuildTopDescriptorsAndMessages(DESCRIPTOR, 'turn_pb2', _globals)
if not _descriptor._USE_C_DESCRIPTORS:
  DESCRIPTOR._loaded_options = None
  _globals['_CHATMESSAGE']._serialized_start=20
  _globals['_CHATMESSAGE']._serialized_end=64
  _globals['_CHATHISTORY']._serialized_start=66
  _globals['_CHATHISTORY']._serialized_end=116
  _globals['_TURNRESPONSE']._serialized_start=118
  _globals['_TURNRESPONSE']._serialized_end=153
  _globals['_TURNDETECTOR']._serialized_start=155
  _globals['_TURNDETECTOR']._serialized_end=226
# @@protoc_insertion_point(module_scope)
