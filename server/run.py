def main():
    import uvicorn
    uvicorn.run('server.app:app', host='127.0.0.1', port=8766, workers=1)


if __name__ == '__main__':
    main()
