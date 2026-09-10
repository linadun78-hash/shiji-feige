from copy import deepcopy

from fastapi.testclient import TestClient
from server.app import create_app
from server.mcp_server import get_selected_context, get_page_outline


def batch():
    return {'schema_version':'2.0','kind':'task_batch','request_id':'62cce0b8-3054-4be7-a36b-a8202761e424','created_at':'2026-09-10T00:00:00Z','response_language':'zh-CN','overall_instruction':'Compare the sources','items':[
        {'id':'a','number':1,'source':{'site':'a.test','url':'https://a.test/','title':'A','captured_at':'2026-09-10T00:00:00Z'},'mode':'selection','content':'Source A','purpose':'Decide what to learn','instruction':'Explain prerequisites','response_language':'en','reference':False},
        {'id':'b','number':2,'source':{'site':'b.test','url':'https://b.test/','title':'B','captured_at':'2026-09-10T00:00:00Z'},'mode':'region','content':'Source B','purpose':'','instruction':'','response_language':'zh-CN','reference':True}]}


def test_batch_round_trip_and_idempotent_retry():
    app=create_app()
    client=TestClient(app)
    data=batch()
    response=client.post('/v1/contexts',json=data)
    assert response.status_code==200,response.text
    context_id=response.json()['data']['context_id']
    assert client.post('/v1/contexts',json=data).json()['data']['context_id']==context_id
    received=get_selected_context(app.state.store,context_id)['data']['context']
    assert received['items']==data['items']
    assert received['overall_instruction']==data['overall_instruction']
    assert get_page_outline(app.state.store)['data']['item_count']==2
    changed=deepcopy(data);changed['items'][0]['purpose']='Different'
    assert client.post('/v1/contexts',json=changed).status_code==409


def test_invalid_batch_never_saved():
    client=TestClient(create_app())
    for edit in ['purpose','number','duplicate','size','language']:
        data=batch()
        if edit=='purpose':data['items'][0]['purpose']=' '
        if edit=='number':data['items'][1]['number']=1
        if edit=='duplicate':data['items'][1]['id']='a'
        if edit=='size':data['items'][0]['content']='x'*100001
        if edit=='language':data['items'][0]['response_language']='xx'
        assert client.post('/v1/contexts',json=data).status_code==422,edit
    assert client.get('/v1/contexts/latest').status_code==404
